import { zValidator } from "@hono/zod-validator";
import {
  checkCapital,
  currencyDigits,
  effectiveRates,
  daysBetween,
  insuranceLines,
  penaltyLines,
  loanEventInputSchema,
  loanInputSchema,
  loanPlanSchema,
  loanQuerySchema,
  loanSchedule,
  loanUpdateSchema,
  matchPayments,
  money,
  paidLines,
  parseAmount,
  toDecimalString,
  type LoanEvent,
  type LoanLine,
} from "@cash-scout/domain";
import { and, asc, eq, inArray, max } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";
import { withUser, type Db, type Tx } from "../db/client.js";
import { bookAccount, journalEntry, loan, loanEvent, split } from "../db/schema.js";
import type { AppEnv } from "../http.js";
import { checked, idOf, missing, requireRole, rowOf } from "./access.js";
import {
  accountOf,
  createEntry,
  refuseTransferSubCategory,
  subCategoryOf,
  usable,
} from "./journal.js";
import { createSplit } from "./splits.js";

type LoanRow = typeof loan.$inferSelect;
type EventRow = typeof loanEvent.$inferSelect;
type Values = z.output<typeof loanInputSchema>;

/** A loan with its events and the currency of its payment account. */
interface Loan {
  row: LoanRow;
  events: EventRow[];
  currency: string;
}

const eventsOf = (events: readonly EventRow[]): LoanEvent[] =>
  events.map(({ date, kind, amount, keeps, ...insurance }) => ({
    date,
    kind,
    amount,
    keeps,
    insuranceMode: insurance.insuranceMode,
    insuranceRate: insurance.insuranceRate ?? undefined,
    insuranceSeparate: insurance.insuranceSeparate,
    insuranceAccountId: insurance.insuranceAccountId,
    penalty: insurance.penalty,
  }));

const scheduleOf = ({ row, events }: Loan): LoanLine[] => loanSchedule(row, eventsOf(events));

async function loadLoans(tx: Tx, bookId: string, id?: string): Promise<Loan[]> {
  const rows = await tx
    .select({ row: loan, currency: bookAccount.currency })
    .from(loan)
    .innerJoin(bookAccount, eq(bookAccount.id, loan.accountId))
    .where(and(eq(loan.bookId, bookId), id ? eq(loan.id, id) : undefined))
    .orderBy(asc(loan.start), asc(loan.name), asc(loan.id));
  if (rows.length === 0) return [];
  const events = await tx
    .select()
    .from(loanEvent)
    .where(
      and(
        eq(loanEvent.bookId, bookId),
        inArray(
          loanEvent.loanId,
          rows.map(({ row }) => row.id),
        ),
      ),
    )
    .orderBy(asc(loanEvent.date), asc(loanEvent.createdAt), asc(loanEvent.id));
  return rows.map((found) => ({
    ...found,
    events: events.filter((event) => event.loanId === found.row.id),
  }));
}

async function loadLoan(tx: Tx, bookId: string, id: string): Promise<Loan> {
  const [found] = await loadLoans(tx, bookId, id);
  if (!found) {
    throw new HTTPException(404, { message: "Loan not found" });
  }
  return found;
}

function outCheck(
  check: NonNullable<ReturnType<typeof checkCapital>>,
  currency: string,
  loans: number,
) {
  const text = (minor: bigint) => toDecimalString(money(minor, currency));
  const gap = check.journal - check.schedule;
  // A unit of the currency is left to the bank's own rounding.
  const tolerance = 10n ** BigInt(currencyDigits(currency));
  return {
    from: check.from,
    to: check.to,
    schedule: text(check.schedule),
    journal: text(check.journal),
    gap: text(gap),
    flagged: gap > tolerance || gap < -tolerance,
    /** How many loans share the capital sub-category and are compared together. */
    loans,
  };
}

/**
 * The capital repaid in the journal against the schedules, for each capital
 * sub-category and currency: loans that share them are compared together.
 */
async function capitalChecks(tx: Tx, bookId: string, loans: Loan[], date: string) {
  const checks = new Map<string, ReturnType<typeof outCheck> | null>();
  const keyOf = (one: Loan) => `${one.row.capitalSubCategoryId}:${one.currency}`;
  for (const one of loans) {
    const key = keyOf(one);
    if (checks.has(key)) continue;
    const group = loans.filter((other) => keyOf(other) === key);
    const [reconciled] = await tx
      .select({ date: max(journalEntry.date) })
      .from(journalEntry)
      .where(
        and(
          eq(journalEntry.bookId, bookId),
          eq(journalEntry.reconciled, true),
          inArray(
            journalEntry.accountId,
            group.map((other) => other.row.accountId),
          ),
        ),
      );
    const entries = await tx
      .select({ date: journalEntry.date, amount: journalEntry.amount })
      .from(journalEntry)
      .innerJoin(bookAccount, eq(bookAccount.id, journalEntry.accountId))
      .where(
        and(
          eq(journalEntry.bookId, bookId),
          eq(journalEntry.reconciled, true),
          eq(journalEntry.subCategoryId, one.row.capitalSubCategoryId),
          eq(bookAccount.currency, one.currency),
        ),
      );
    const last = reconciled?.date;
    const found = last
      ? checkCapital(group.flatMap(scheduleOf), entries, last < date ? last : date)
      : undefined;
    checks.set(key, found ? outCheck(found, one.currency, group.length) : null);
  }
  return (one: Loan) => checks.get(keyOf(one)) ?? null;
}

/** The TEG, with and without the insurance, in percent with two decimals. */
function effectiveOf(row: LoanRow, events: readonly EventRow[]) {
  const rates = effectiveRates(row, eventsOf(events));
  const text = (rate: number | null) => (rate === null ? null : rate.toFixed(2));
  return {
    withInsurance: text(rates.withInsurance),
    withoutInsurance: text(rates.withoutInsurance),
  };
}

function outLoan({ row, events, currency }: Loan, lines: LoanLine[], date: string) {
  const text = (minor: bigint) => toDecimalString(money(minor, currency));
  const { bookId, createdAt, updatedAt, amount, ...terms } = row;
  void bookId;
  void createdAt;
  void updatedAt;
  const past = lines.filter((line) => line.date <= date);
  const next = lines.find((line) => line.kind === "payment" && line.date > date);
  const released = events.some((event) => event.kind === "drawdown") ? 0n : amount;
  return {
    ...terms,
    amount: text(amount),
    currency,
    /** Capital left to repay at the end of `date`. */
    remaining: text(past.at(-1)?.remaining ?? released),
    nextPayment: next ? { date: next.date, total: text(next.total) } : null,
    end: lines.at(-1)?.date ?? null,
    effectiveRate: effectiveOf(row, events),
    events: events.map((event) => ({
      id: event.id,
      version: event.version,
      date: event.date,
      kind: event.kind,
      amount: event.amount === null ? null : text(event.amount),
      keeps: event.keeps,
      insuranceMode: event.insuranceMode,
      insuranceRate: event.insuranceRate,
      insuranceSeparate: event.insuranceSeparate,
      insuranceAccountId: event.insuranceAccountId,
      penalty: event.penalty === null ? null : text(event.penalty),
      note: event.note,
    })),
  };
}

/** One loan as the list shows it, its capital check included. */
async function respond(tx: Tx, bookId: string, id: string) {
  const date = new Date().toISOString().slice(0, 10);
  const all = await loadLoans(tx, bookId);
  const found = all.find((one) => one.row.id === id);
  if (!found) {
    throw new HTTPException(404, { message: "Loan not found" });
  }
  const checkOf = await capitalChecks(tx, bookId, all, date);
  return { ...outLoan(found, scheduleOf(found), date), check: checkOf(found) };
}

/**
 * The stored values of a loan, its account and sub-categories checked against
 * the book. Archived items stay allowed on the loan that already uses them.
 */
async function loanValues(tx: Tx, bookId: string, input: Values, current?: Loan) {
  const account = await usable(
    accountOf(tx, bookId, input.accountId),
    "account",
    current?.row.accountId === input.accountId,
  );
  // The events' amounts are kept in the account's currency.
  if (current && current.currency !== account.currency) {
    throw new HTTPException(400, { message: "The currency of a loan cannot change" });
  }
  const used = new Set(
    current
      ? [
          current.row.capitalSubCategoryId,
          current.row.interestSubCategoryId,
          current.row.insuranceSubCategoryId,
          current.row.penaltySubCategoryId,
        ]
      : [],
  );
  const insured = input.insuranceMode !== "none";
  const separate = insured && input.insuranceSeparate;
  const insuranceAccountId = separate ? input.insuranceAccountId : null;
  if (insuranceAccountId) {
    await insuranceAccount(tx, bookId, insuranceAccountId, account.currency, current);
  }
  const parts = [
    ...(input.penaltySubCategoryId ? [input.penaltySubCategoryId] : []),
    input.capitalSubCategoryId,
    input.interestSubCategoryId,
    ...(insured ? [input.insuranceSubCategoryId!] : []),
  ];
  for (const id of parts) {
    await usable(subCategoryOf(tx, bookId, id), "sub-category", used.has(id));
    await refuseTransferSubCategory(tx, bookId, id);
  }
  return {
    name: input.name,
    lender: input.lender,
    amount: checked(() => parseAmount(input.amount, account.currency)).minor,
    rate: input.rate,
    term: input.term,
    start: input.start,
    insuranceMode: input.insuranceMode,
    insuranceRate: insured ? input.insuranceRate : "0",
    insuranceSeparate: separate,
    insuranceAccountId,
    deferralMode: input.deferralMode,
    deferralMonths: input.deferralMonths,
    accountId: input.accountId,
    capitalSubCategoryId: input.capitalSubCategoryId,
    interestSubCategoryId: input.interestSubCategoryId,
    insuranceSubCategoryId: insured ? input.insuranceSubCategoryId : null,
    penaltySubCategoryId: input.penaltySubCategoryId,
  };
}

/** Drawdowns release no more than the amount borrowed. */
async function checkDrawdowns(tx: Tx, bookId: string, id: string) {
  const found = await loadLoan(tx, bookId, id);
  const released = found.events
    .filter((event) => event.kind === "drawdown")
    .reduce((sum, event) => sum + event.amount!, 0n);
  if (released > found.row.amount) {
    throw new HTTPException(400, { message: "The drawdowns exceed the amount borrowed" });
  }
  if (!found.row.penaltySubCategoryId && found.events.some((event) => event.penalty !== null)) {
    throw new HTTPException(400, { message: "The loan needs a sub-category for penalties" });
  }
}

/**
 * The account of a separate insurance: one of the book, in the currency of the
 * loan (its amounts are in it). An archived one stays allowed where it is used.
 */
async function insuranceAccount(
  tx: Tx,
  bookId: string,
  id: string,
  currency: string,
  current?: Loan,
) {
  const used = current
    ? [current.row.insuranceAccountId, ...current.events.map((e) => e.insuranceAccountId)]
    : [];
  const account = await usable(accountOf(tx, bookId, id), "account", used.includes(id));
  if (account.currency !== currency) {
    throw new HTTPException(400, {
      message: "The insurance account must be in the currency of the loan",
    });
  }
}

async function eventValues(
  tx: Tx,
  bookId: string,
  input: z.output<typeof loanEventInputSchema>,
  found: Loan,
) {
  const { amount, penalty } = input;
  if (penalty !== null && !found.row.penaltySubCategoryId) {
    throw new HTTPException(400, { message: "The loan needs a sub-category for penalties" });
  }
  const insurance = input.kind === "insurance";
  const separate = insurance && input.insuranceMode !== "none" && input.insuranceSeparate;
  const insuranceAccountId = separate ? input.insuranceAccountId : null;
  if (insuranceAccountId) {
    await insuranceAccount(tx, bookId, insuranceAccountId, found.currency, found);
  }
  return {
    date: input.date,
    kind: input.kind,
    amount: amount === null ? null : checked(() => parseAmount(amount, found.currency)).minor,
    keeps: input.keeps,
    insuranceMode: insurance ? input.insuranceMode : null,
    insuranceRate: insurance ? (input.insuranceMode === "none" ? "0" : input.insuranceRate) : null,
    insuranceSeparate: separate,
    insuranceAccountId,
    note: input.note,
    penalty: penalty === null ? null : checked(() => parseAmount(penalty, found.currency)).minor,
  };
}

/** What the journal holds for one payment: a split, or an entry on its own. */
interface Planned {
  id: string;
  splitId: string | null;
  date: string;
  /** What leaves the account: the negation of the entries. */
  total: bigint;
  reconciled: boolean;
  monthShifted: boolean;
  exchangeRate: string;
  accountId: string | null;
  parts: { subCategoryId: string; amount: bigint }[];
}

function grouped(rows: (typeof journalEntry.$inferSelect)[]): Planned[] {
  const groups = new Map<string, Planned>();
  for (const row of rows) {
    const key = row.splitId ?? row.id;
    const group = groups.get(key) ?? {
      id: row.id,
      splitId: row.splitId,
      date: row.date,
      total: 0n,
      reconciled: row.reconciled,
      monthShifted: row.monthShifted,
      exchangeRate: row.exchangeRate,
      accountId: row.accountId,
      parts: [],
    };
    group.total -= row.amount;
    group.parts.push({ subCategoryId: row.subCategoryId, amount: row.amount });
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** A payment entered by hand is within a few days, with the same capital. */
const HAND_DAYS = 5;

/**
 * Which payments of a schedule the journal already holds: those planned from
 * the loan (with every part of their split), then those entered by hand, told
 * by the capital they repay on the payment account.
 */
/** What is paid apart from a payment, as an entry of its own. */
type Apart = "insurance" | "penalty";

const apartAmount = (kind: Apart, line: LoanLine) =>
  kind === "insurance" ? line.insurance : line.penalty;

const apartLines = (kind: Apart, lines: readonly LoanLine[]) =>
  kind === "insurance" ? insuranceLines(lines) : penaltyLines(lines);

async function inJournal(tx: Tx, bookId: string, { row }: Loan, lines: LoanLine[]) {
  const all = await tx
    .select()
    .from(journalEntry)
    .where(and(eq(journalEntry.bookId, bookId), eq(journalEntry.loanId, row.id)));
  // An insurance paid apart, or a penalty, is an entry of its own, matched with its own lines.
  const linked = all.filter((entry) => entry.loanPart === "payment");
  const apartItems = {
    insurance: grouped(all.filter((entry) => entry.loanPart === "insurance")),
    penalty: grouped(all.filter((entry) => entry.loanPart === "penalty")),
  };
  const splitIds = [...new Set(linked.flatMap((entry) => entry.splitId ?? []))];
  // A part added to a planned split is part of the payment too.
  const rows =
    splitIds.length === 0
      ? linked
      : [
          ...linked.filter((entry) => !entry.splitId),
          ...(await tx
            .select()
            .from(journalEntry)
            .where(and(eq(journalEntry.bookId, bookId), inArray(journalEntry.splitId, splitIds)))),
        ];
  const items = grouped(rows);
  const matched = matchPayments(lines, items);
  const found: ({ reconciled: boolean; item?: Planned } | undefined)[] = matched.map((at) =>
    at === undefined ? undefined : { reconciled: items[at]!.reconciled, item: items[at]! },
  );
  const onAccount = await tx
    .select({
      loanId: journalEntry.loanId,
      date: journalEntry.date,
      amount: journalEntry.amount,
      reconciled: journalEntry.reconciled,
    })
    .from(journalEntry)
    .where(
      and(
        eq(journalEntry.bookId, bookId),
        eq(journalEntry.accountId, row.accountId),
        eq(journalEntry.subCategoryId, row.capitalSubCategoryId),
      ),
    );
  const byHand = onAccount.filter((entry) => entry.loanId === null);
  lines.forEach((line, index) => {
    if (found[index] || line.capital === 0n) return;
    const at = byHand.findIndex(
      (entry) =>
        entry.amount === -line.capital && Math.abs(daysBetween(line.date, entry.date)) <= HAND_DAYS,
    );
    if (at >= 0) found[index] = { reconciled: byHand.splice(at, 1)[0]!.reconciled };
  });
  const apartFound = (kind: Apart, lines: readonly LoanLine[]) => {
    const items = apartItems[kind];
    const pairs = matchPayments(
      lines.map((line) => ({ date: line.date, total: apartAmount(kind, line) })),
      items,
    );
    return { items, pairs, found: pairs.map((at) => (at === undefined ? undefined : items[at]!)) };
  };
  return {
    found,
    /** Planned from the loan, and no longer in its schedule. */
    orphans: items.filter((_, at) => !matched.includes(at)),
    apartFound,
  };
}

/** The parts of a payment, as entries on the account: money leaving it. */
function partsOf({ row }: Loan, line: LoanLine) {
  return [
    { subCategoryId: row.capitalSubCategoryId, amount: -line.capital },
    { subCategoryId: row.interestSubCategoryId, amount: -line.interest },
    // A repayment has no insurance, nor has an uninsured loan, nor one paid apart.
    ...(line.insuranceSeparate
      ? []
      : [{ subCategoryId: row.insuranceSubCategoryId!, amount: -line.insurance }]),
  ].filter((part) => part.amount !== 0n);
}

const sameParts = (a: Planned["parts"], b: Planned["parts"]) => {
  const key = (parts: Planned["parts"]) =>
    parts
      .map((part) => `${part.subCategoryId}:${part.amount}`)
      .sort()
      .join();
  return key(a) === key(b);
};

async function removeItem(tx: Tx, bookId: string, item: Planned) {
  if (item.splitId) {
    await tx.delete(split).where(and(eq(split.id, item.splitId), eq(split.bookId, bookId)));
  } else {
    await tx
      .delete(journalEntry)
      .where(and(eq(journalEntry.id, item.id), eq(journalEntry.bookId, bookId)));
  }
}

/**
 * Writes one payment: a planned split, or a planned entry when it has a single
 * part. The interest takes the difference with the bank's amount.
 */
async function writePayment(
  tx: Tx,
  bookId: string,
  found: Loan,
  line: LoanLine,
  options: { date: string; monthShifted: boolean; exchangeRate: string | undefined },
) {
  const { row, currency } = found;
  const parts = partsOf(found, line).map((part) => ({
    subCategoryId: part.subCategoryId,
    amount: toDecimalString(money(part.amount, currency)),
    description: row.name,
  }));
  const common = { ...options, accountId: row.accountId, planned: true };
  const mark = { loanId: row.id };
  if (parts.length === 1) {
    const entry = await createEntry(tx, bookId, { ...common, ...parts[0]! });
    await tx.update(journalEntry).set(mark).where(eq(journalEntry.id, entry.id));
    return;
  }
  const interest = parts.findIndex((part) => part.subCategoryId === row.interestSubCategoryId);
  const remainder = line.interest > 0n ? interest : 0;
  const id = await createSplit(tx, bookId, {
    ...common,
    parts: parts.map((part, index) => ({ ...part, remainder: index === remainder })),
  });
  await tx.update(journalEntry).set(mark).where(eq(journalEntry.splitId, id));
}

/** Writes what is paid apart from a payment as an entry of its own, planned. */
async function writeApart(
  tx: Tx,
  bookId: string,
  found: Loan,
  kind: Apart,
  line: LoanLine,
  options: { date: string; monthShifted: boolean; exchangeRate: string | undefined },
) {
  const { row, currency } = found;
  const insurance = kind === "insurance";
  const entry = await createEntry(tx, bookId, {
    ...options,
    accountId: (insurance ? line.insuranceAccountId : null) ?? row.accountId,
    subCategoryId: (insurance ? row.insuranceSubCategoryId : row.penaltySubCategoryId)!,
    description: row.name,
    amount: toDecimalString(money(-apartAmount(kind, line), currency)),
    planned: true,
  });
  await tx
    .update(journalEntry)
    .set({ loanId: row.id, loanPart: kind })
    .where(eq(journalEntry.id, entry.id));
}

/**
 * Brings the planned payments of a year in line with the schedule: adds those
 * the journal lacks, replaces the forecasts planned from the loan whose amounts
 * changed, and removes those the schedule no longer has. Reconciled entries are
 * never touched.
 */
async function planYear(
  tx: Tx,
  bookId: string,
  found: Loan,
  { year, exchangeRate }: z.output<typeof loanPlanSchema>,
) {
  const lines = paidLines(scheduleOf(found));
  const journal = await inJournal(tx, bookId, found, lines);
  const inYear = (date: string) => date.startsWith(`${year}-`);
  const result = { created: 0, replaced: 0, removed: 0 };
  for (const item of journal.orphans) {
    if (!inYear(item.date) || item.reconciled) continue;
    await removeItem(tx, bookId, item);
    result.removed++;
  }
  for (const [index, line] of lines.entries()) {
    if (!inYear(line.date)) continue;
    const there = journal.found[index];
    if (!there) {
      await writePayment(tx, bookId, found, line, {
        date: line.date,
        monthShifted: false,
        exchangeRate,
      });
      result.created++;
      continue;
    }
    const { item } = there;
    if (!item || item.reconciled || sameParts(item.parts, partsOf(found, line))) continue;
    await removeItem(tx, bookId, item);
    // The day and the budget month chosen for the forecast are kept.
    await writePayment(tx, bookId, found, line, {
      date: item.date,
      monthShifted: item.monthShifted,
      exchangeRate: exchangeRate ?? item.exchangeRate,
    });
    result.replaced++;
  }

  // The insurances paid apart and the penalties, each an entry of its own.
  for (const kind of ["insurance", "penalty"] as const) {
    const apart = apartLines(kind, scheduleOf(found));
    const { items, pairs, found: there } = journal.apartFound(kind, apart);
    for (const [at, item] of items.entries()) {
      if (!inYear(item.date) || item.reconciled || pairs.includes(at)) continue;
      await removeItem(tx, bookId, item);
      result.removed++;
    }
    for (const [index, line] of apart.entries()) {
      if (!inYear(line.date)) continue;
      const item = there[index];
      const accountId =
        (kind === "insurance" ? line.insuranceAccountId : null) ?? found.row.accountId;
      if (!item) {
        await writeApart(tx, bookId, found, kind, line, {
          date: line.date,
          monthShifted: false,
          exchangeRate,
        });
        result.created++;
        continue;
      }
      if (
        item.reconciled ||
        (item.total === apartAmount(kind, line) && item.accountId === accountId)
      ) {
        continue;
      }
      await removeItem(tx, bookId, item);
      await writeApart(tx, bookId, found, kind, line, {
        date: item.date,
        monthShifted: item.monthShifted,
        exchangeRate: exchangeRate ?? item.exchangeRate,
      });
      result.replaced++;
    }
  }
  return result;
}

/**
 * Loans of a book, mounted under /books/:bookId/loans (see docs/wealth.md).
 * Their schedule is computed on demand. Members read; editors and owners write.
 */
export function loanRoutes(db: Db) {
  return (
    new Hono<AppEnv>()
      // Every loan, with its remaining capital at a date.
      .get("/", zValidator("query", loanQuerySchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const { date } = c.req.valid("query");
        const result = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "viewer");
          const loans = await loadLoans(tx, bookId);
          const checkOf = await capitalChecks(tx, bookId, loans, date);
          return loans.map((one) => ({
            ...outLoan(one, scheduleOf(one), date),
            check: checkOf(one),
          }));
        });
        return c.json(result);
      })

      .get("/:id/schedule", async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Loan");
        const result = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "viewer");
          const found = await loadLoan(tx, bookId, id);
          const lines = scheduleOf(found);
          const paid = paidLines(lines);
          const journal = await inJournal(tx, bookId, found, paid);
          const state = new Map(paid.map((line, index) => [line, journal.found[index]]));
          const apartState = (kind: Apart) => {
            const apart = apartLines(kind, lines);
            const { found: there } = journal.apartFound(kind, apart);
            return new Map(apart.map((line, index) => [line, there[index]]));
          };
          const insuranceState = apartState("insurance");
          const penaltyState = apartState("penalty");
          const stateOf = (entry: { reconciled: boolean } | undefined) =>
            entry ? (entry.reconciled ? ("reconciled" as const) : ("planned" as const)) : null;
          const text = (minor: bigint) => toDecimalString(money(minor, found.currency));
          return {
            currency: found.currency,
            lines: lines.map((line) => {
              const entry = state.get(line);
              return {
                date: line.date,
                kind: line.kind,
                number: line.number,
                capital: text(line.capital),
                interest: text(line.interest),
                insurance: text(line.insurance),
                total: text(line.total),
                remaining: text(line.remaining),
                insuranceSeparate: line.insuranceSeparate,
                insuranceAccountId: line.insuranceAccountId,
                penalty: text(line.penalty),
                /** What the journal holds for a separate insurance or a penalty, if anything. */
                insuranceJournal: stateOf(insuranceState.get(line)),
                penaltyJournal: stateOf(penaltyState.get(line)),
                /** What the journal holds for the payment, if anything. */
                journal: entry
                  ? entry.reconciled
                    ? ("reconciled" as const)
                    : ("planned" as const)
                  : null,
              };
            }),
          };
        });
        return c.json(result);
      })

      .post("/", zValidator("json", loanInputSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const input = c.req.valid("json");
        const result = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const values = await loanValues(tx, bookId, input);
          const [created] = await tx
            .insert(loan)
            .values({ bookId, ...values })
            .returning({ id: loan.id });
          return respond(tx, bookId, created!.id);
        });
        return c.json(result, 201);
      })

      .patch("/:id", zValidator("json", loanUpdateSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Loan");
        const { version, ...input } = c.req.valid("json");
        const result = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const current = await loadLoan(tx, bookId, id);
          const values = await loanValues(tx, bookId, input, current);
          const [updated] = await tx
            .update(loan)
            .set(values)
            .where(rowOf(loan, bookId, id, version))
            .returning({ id: loan.id });
          if (!updated) return missing("Loan", version);
          await checkDrawdowns(tx, bookId, id);
          return respond(tx, bookId, id);
        });
        return c.json(result);
      })

      // The entries planned from the loan stay in the journal.
      .delete("/:id", async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Loan");
        await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          await tx
            .update(journalEntry)
            .set({ loanId: null })
            .where(and(eq(journalEntry.bookId, bookId), eq(journalEntry.loanId, id)));
          const deleted = await tx
            .delete(loan)
            .where(rowOf(loan, bookId, id))
            .returning({ id: loan.id });
          if (deleted.length === 0) return missing("Loan");
        });
        return c.body(null, 204);
      })

      .post("/:id/events", zValidator("json", loanEventInputSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Loan");
        const input = c.req.valid("json");
        const result = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const found = await loadLoan(tx, bookId, id);
          await tx
            .insert(loanEvent)
            .values({ bookId, loanId: id, ...(await eventValues(tx, bookId, input, found)) });
          await checkDrawdowns(tx, bookId, id);
          return respond(tx, bookId, id);
        });
        return c.json(result, 201);
      })

      .patch("/:id/events/:eventId", zValidator("json", loanEventInputSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Loan");
        const eventId = idOf(c.req.param("eventId"), "Event");
        const input = c.req.valid("json");
        const result = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const found = await loadLoan(tx, bookId, id);
          const [updated] = await tx
            .update(loanEvent)
            .set(await eventValues(tx, bookId, input, found))
            .where(and(rowOf(loanEvent, bookId, eventId, input.version), eq(loanEvent.loanId, id)))
            .returning({ id: loanEvent.id });
          if (!updated) return missing("Event", input.version);
          await checkDrawdowns(tx, bookId, id);
          return respond(tx, bookId, id);
        });
        return c.json(result);
      })

      .delete("/:id/events/:eventId", async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Loan");
        const eventId = idOf(c.req.param("eventId"), "Event");
        await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const deleted = await tx
            .delete(loanEvent)
            .where(and(rowOf(loanEvent, bookId, eventId), eq(loanEvent.loanId, id)))
            .returning({ id: loanEvent.id });
          if (deleted.length === 0) return missing("Event");
        });
        return c.body(null, 204);
      })

      // The planned payments of a year, from the schedule.
      .post("/:id/plan", zValidator("json", loanPlanSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Loan");
        const input = c.req.valid("json");
        const result = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          return planYear(tx, bookId, await loadLoan(tx, bookId, id), input);
        });
        return c.json(result);
      })
  );
}

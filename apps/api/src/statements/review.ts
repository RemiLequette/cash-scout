import {
  addDays,
  bookAmount,
  budgetMonth,
  decide,
  firstRule,
  forecastWindowDays,
  matchLines,
  money,
  openingFromBalance,
  resolveRate,
  shiftToKeep,
  takesAmount,
  type ImportRequest,
  type LineChange,
} from "@cash-scout/domain";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { Tx } from "../db/client.js";
import {
  bookAccount,
  category,
  importBatch,
  importLine,
  importRule,
  journalEntry,
  nature,
  subCategory,
  transfer,
} from "../db/schema.js";
import { checked } from "../routes/access.js";
import { bookCurrencyOf } from "../routes/journal.js";

/** The review of an import batch and its import into the journal. */

const bad = (message: string) => new HTTPException(400, { message });

export async function batchOf(tx: Tx, bookId: string, id: string, lock = false) {
  const query = tx
    .select({
      id: importBatch.id,
      accountId: importBatch.accountId,
      preset: importBatch.preset,
      fileName: importBatch.fileName,
      createdAt: importBatch.createdAt,
    })
    .from(importBatch)
    .where(and(eq(importBatch.id, id), eq(importBatch.bookId, bookId)));
  // The lock keeps two imports of the same batch from both creating its entries.
  const [batch] = await (lock ? query.for("update") : query);
  if (!batch) {
    throw new HTTPException(404, { message: "Batch not found" });
  }
  const [account] = await tx
    .select({
      currency: bookAccount.currency,
      openingBalance: bookAccount.openingBalance,
      archivedAt: bookAccount.archivedAt,
    })
    .from(bookAccount)
    .where(eq(bookAccount.id, batch.accountId));
  return { ...batch, account: account! };
}

export function linesOf(tx: Tx, batchId: string) {
  return tx
    .select()
    .from(importLine)
    .where(eq(importLine.batchId, batchId))
    .orderBy(desc(importLine.date), asc(importLine.row));
}
type Line = Awaited<ReturnType<typeof linesOf>>[number];

const entryColumns = {
  id: journalEntry.id,
  date: journalEntry.date,
  amount: journalEntry.amount,
  reconciled: journalEntry.reconciled,
  description: journalEntry.description,
  subCategoryId: journalEntry.subCategoryId,
  transferId: journalEntry.transferId,
  splitId: journalEntry.splitId,
  splitRemainder: journalEntry.splitRemainder,
};
type EntryRow = Awaited<ReturnType<typeof entriesByIds>>[number];

/** A part of a split, as the review lists it. */
export interface SplitPart {
  subCategoryId: string;
  description: string;
  amount: bigint;
}

/**
 * An entry a line may be. A split is one candidate, its remainder: its amount is
 * the bank amount, the sum of its parts, which are listed.
 */
export type CandidateEntry = EntryRow & { split: SplitPart[] | null };

/** The parts of splits, by split, the remainder last. */
export async function splitParts(tx: Tx, bookId: string, ids: readonly string[]) {
  const parts = new Map<string, (SplitPart & { id: string; remainder: boolean })[]>();
  if (ids.length === 0) return parts;
  const rows = await tx
    .select({
      id: journalEntry.id,
      splitId: journalEntry.splitId,
      subCategoryId: journalEntry.subCategoryId,
      description: journalEntry.description,
      amount: journalEntry.amount,
      remainder: journalEntry.splitRemainder,
    })
    .from(journalEntry)
    .where(and(eq(journalEntry.bookId, bookId), inArray(journalEntry.splitId, [...ids])))
    .orderBy(asc(journalEntry.splitRemainder), asc(journalEntry.createdAt), asc(journalEntry.id));
  for (const { splitId, ...part } of rows) {
    parts.set(splitId!, [...(parts.get(splitId!) ?? []), part]);
  }
  return parts;
}

const total = (parts: readonly { amount: bigint }[]) =>
  parts.reduce((sum, p) => sum + p.amount, 0n);

/** Entries as candidates: those that are a split are given the bank amount and their parts. */
async function asCandidates(tx: Tx, bookId: string, rows: readonly EntryRow[]) {
  const parts = await splitParts(
    tx,
    bookId,
    rows.flatMap((row) => (row.splitId ? [row.splitId] : [])),
  );
  return rows.map((row): CandidateEntry => {
    const of = row.splitId ? parts.get(row.splitId) : undefined;
    return of ? { ...row, amount: total(of), split: of } : { ...row, split: null };
  });
}

function entriesByIds(tx: Tx, bookId: string, ids: string[]) {
  return tx
    .select(entryColumns)
    .from(journalEntry)
    .where(and(eq(journalEntry.bookId, bookId), inArray(journalEntry.id, ids)));
}

/** The entries that some statement line already is, whatever its batch. */
async function claimedEntries(tx: Tx, bookId: string) {
  const rows = await tx
    .select({ lineId: importLine.id, entryId: importLine.entryId })
    .from(importLine)
    .where(and(eq(importLine.bookId, bookId), isNotNull(importLine.entryId)));
  return new Map(rows.map((r) => [r.entryId!, r.lineId]));
}

/** How far from a line a forecast can still be chosen by hand. */
const pickWindowDays = 45;

/**
 * The journal entries each undecided line may already be, every entry the lines
 * refer to (proposed or chosen) by id, the forecasts no line is (to choose by
 * hand), and those among them dated within the statement: they are likely lines
 * about to be written twice.
 */
export async function proposals(tx: Tx, bookId: string, accountId: string, lines: readonly Line[]) {
  const entries = new Map<string, CandidateEntry>();
  let matches = new Map<string, string[]>();
  let forecasts: CandidateEntry[] = [];
  let unmatched: CandidateEntry[] = [];
  const dates = lines.map((l) => l.date).sort();
  if (dates.length > 0) {
    const [first, last] = [dates[0]!, dates.at(-1)!];
    const claimed = await claimedEntries(tx, bookId);
    const around = await tx
      .select(entryColumns)
      .from(journalEntry)
      .where(
        and(
          eq(journalEntry.bookId, bookId),
          eq(journalEntry.accountId, accountId),
          gte(journalEntry.date, addDays(first, -pickWindowDays)),
          lte(journalEntry.date, addDays(last, pickWindowDays)),
        ),
      )
      .orderBy(asc(journalEntry.date));
    // A split is one candidate, by its remainder, with the bank amount of the whole.
    const free = await asCandidates(
      tx,
      bookId,
      around.filter((e) => !claimed.has(e.id) && (!e.splitId || e.splitRemainder)),
    );
    matches = matchLines(
      lines.filter((l) => l.status === "review"),
      free.map((e) => ({ ...e, transfer: e.transferId !== null })),
    );
    for (const entry of free) entries.set(entry.id, entry);
    forecasts = free.filter((e) => !e.reconciled);
    // A line's proposal is not yet claimed, but it is not forgotten either.
    const proposed = new Set([...matches.values()].map((ids) => ids[0]));
    const end = addDays(last, forecastWindowDays);
    unmatched = forecasts.filter((e) => e.date >= first && e.date <= end && !proposed.has(e.id));
  }
  const chosen = lines.flatMap((l) => (l.entryId ? [l.entryId] : []));
  if (chosen.length > 0) {
    const rows = await entriesByIds(tx, bookId, chosen);
    for (const entry of await asCandidates(tx, bookId, rows)) entries.set(entry.id, entry);
  }
  return { matches, entries, forecasts, unmatched };
}

/** May the line be this entry: same account, and the same amount unless a forecast takes it. */
function lineMayBe(
  line: { amount: bigint },
  accountId: string,
  entry: {
    accountId: string | null;
    amount: bigint;
    reconciled: boolean;
    transferId: string | null;
  },
) {
  return (
    entry.accountId === accountId &&
    (entry.amount === line.amount ||
      takesAmount({ reconciled: entry.reconciled, transfer: entry.transferId !== null }))
  );
}

/** The accounts a line of the batch can make a transfer with: same currency, not archived, not its own. */
async function usableTransferAccounts(
  tx: Tx,
  bookId: string,
  batch: { accountId: string; account: { currency: string } },
) {
  const rows = await tx
    .select({ id: bookAccount.id })
    .from(bookAccount)
    .where(
      and(
        eq(bookAccount.bookId, bookId),
        eq(bookAccount.currency, batch.account.currency),
        isNull(bookAccount.archivedAt),
        ne(bookAccount.id, batch.accountId),
      ),
    );
  return new Set(rows.map((r) => r.id));
}

/** The sub-categories whose category has a transfer nature. */
async function transferSubCategories(tx: Tx, bookId: string) {
  const rows = await tx
    .select({ id: subCategory.id })
    .from(subCategory)
    .innerJoin(category, eq(category.id, subCategory.categoryId))
    .innerJoin(nature, eq(nature.id, category.natureId))
    .where(and(eq(subCategory.bookId, bookId), eq(nature.transfer, true)));
  return new Set(rows.map((r) => r.id));
}

/** Applies the user's decisions to the lines of a batch. */
export async function applyChanges(
  tx: Tx,
  bookId: string,
  batchId: string,
  changes: readonly LineChange[],
) {
  const batch = await batchOf(tx, bookId, batchId, true);
  const lines = new Map((await linesOf(tx, batchId)).map((l) => [l.id, l]));
  const claimed = await claimedEntries(tx, bookId);

  const subIds = [...new Set(changes.flatMap((c) => (c.subCategoryId ? [c.subCategoryId] : [])))];
  if (subIds.length > 0) {
    const found = await tx
      .select({ id: subCategory.id, archivedAt: subCategory.archivedAt })
      .from(subCategory)
      .where(and(eq(subCategory.bookId, bookId), inArray(subCategory.id, subIds)));
    if (found.length !== subIds.length) throw bad("Unknown sub-category");
    if (found.some((s) => s.archivedAt)) throw bad("The sub-category is archived");
  }
  const entryIds = [...new Set(changes.flatMap((c) => (c.entryId ? [c.entryId] : [])))];
  const entries = new Map(
    entryIds.length === 0
      ? []
      : (
          await tx
            .select({
              id: journalEntry.id,
              accountId: journalEntry.accountId,
              amount: journalEntry.amount,
              reconciled: journalEntry.reconciled,
              transferId: journalEntry.transferId,
              splitId: journalEntry.splitId,
              splitRemainder: journalEntry.splitRemainder,
            })
            .from(journalEntry)
            .where(and(eq(journalEntry.bookId, bookId), inArray(journalEntry.id, entryIds)))
        ).map((e) => [e.id, e]),
  );
  // A split is matched by its remainder, for the bank amount of the whole.
  const splitTotals = new Map(
    [
      ...(await splitParts(tx, bookId, [
        ...new Set([...entries.values()].flatMap((e) => (e.splitId ? [e.splitId] : []))),
      ])),
    ].map(([id, parts]) => [id, total(parts)] as const),
  );

  const transferAccounts = await usableTransferAccounts(tx, bookId, batch);
  const transferSubs = await transferSubCategories(tx, bookId);

  for (const change of changes) {
    const line = lines.get(change.id);
    if (!line) throw bad("Unknown line");
    const next = checked(() => decide(line, change));
    if (next.transferAccountId) {
      if (!transferAccounts.has(next.transferAccountId)) {
        throw bad("A transfer goes to another account of the book, in the same currency");
      }
      if (!next.subCategoryId || !transferSubs.has(next.subCategoryId)) {
        throw bad("A transfer needs a sub-category of a transfer category");
      }
    }
    if (change.entryId) {
      const found = entries.get(change.entryId);
      if (found?.splitId && !found.splitRemainder) {
        throw bad("This entry is a part of a split: the split is matched by its remainder");
      }
      const entry = found && {
        ...found,
        amount: found.splitId ? splitTotals.get(found.splitId)! : found.amount,
      };
      if (!entry || !lineMayBe(line, batch.accountId, entry)) {
        throw bad("The entry is not of this account, or its amount cannot change");
      }
      const owner = claimed.get(change.entryId);
      if (owner !== undefined && owner !== line.id) {
        throw bad("Another statement line is already this entry");
      }
    }
    if (line.entryId && line.entryId !== next.entryId) claimed.delete(line.entryId);
    if (next.entryId) claimed.set(next.entryId, line.id);
    const description =
      change.description === undefined ? line.description : change.description || null;
    // What the user changes by hand is no longer a rule's proposal; accepting one is not a change.
    const touched =
      (change.subCategoryId !== undefined && change.subCategoryId !== line.subCategoryId) ||
      description !== line.description;
    const ruleId = touched ? null : line.ruleId;
    Object.assign(line, next, { description, ruleId });
    await tx
      .update(importLine)
      .set({ ...next, description, ruleId })
      .where(eq(importLine.id, line.id));
  }
}

/** The statement's balance at its last date with one: the most frequent that day. */
function lastBalance(lines: readonly Line[]) {
  const dated = lines.filter((l) => l.balance !== null);
  if (dated.length === 0) return null;
  const date = dated
    .map((l) => l.date)
    .sort()
    .at(-1)!;
  const seen = new Map<bigint, number>();
  for (const line of dated) {
    if (line.date === date) seen.set(line.balance!, (seen.get(line.balance!) ?? 0) + 1);
  }
  return { date, balance: [...seen].sort((a, b) => b[1] - a[1])[0]![0] };
}

/**
 * The opening balance the statement gives once every validated line is in the
 * journal. Offered only when no line is left to review: a line imported later
 * would otherwise be counted twice. Null when it cannot be told.
 */
export async function openingOf(
  tx: Tx,
  accountId: string,
  lines: readonly Line[],
): Promise<{ date: string; balance: bigint; proposed: bigint; suggested: boolean } | null> {
  const last = lastBalance(lines);
  if (!last || lines.some((l) => l.status === "review")) return null;

  // Reconciled up to the statement's date, and whatever the batch's lines are even if dated later.
  const ofBatch = lines.flatMap((l) => (l.entryId && l.status !== "ignored" ? [l.entryId] : []));
  const [sum] = await tx
    .select({ total: sql<string>`coalesce(sum(${journalEntry.amount}), 0)` })
    .from(journalEntry)
    .where(
      and(
        eq(journalEntry.accountId, accountId),
        eq(journalEntry.reconciled, true),
        or(
          lte(journalEntry.date, last.date),
          ofBatch.length > 0 ? inArray(journalEntry.id, ofBatch) : undefined,
        ),
      ),
    );
  // What the import is about to reconcile: new entries, and forecasts matched.
  const pending = lines.filter((l) => l.status === "validated");
  const matched = pending.flatMap((l) => (l.entryId ? [l.entryId] : []));
  const forecasts = new Set(
    matched.length === 0
      ? []
      : (
          await tx
            .select({ id: journalEntry.id })
            .from(journalEntry)
            .where(and(inArray(journalEntry.id, matched), eq(journalEntry.reconciled, false)))
        ).map((e) => e.id),
  );
  const added = pending
    .filter((l) => !l.entryId || forecasts.has(l.entryId))
    .reduce((total, l) => total + l.amount, 0n);
  const [history] = await tx
    .select({ id: journalEntry.id })
    .from(journalEntry)
    .where(eq(journalEntry.accountId, accountId))
    .limit(1);
  return {
    suggested: history === undefined,
    date: last.date,
    balance: last.balance,
    proposed: openingFromBalance(last.balance, BigInt(sum!.total) + added),
  };
}

/** An amount of an entry and what it is in the book currency, at the entry's rate. */
function amounts(minor: bigint, currency: string, rate: string, bookCurrency: string) {
  return {
    amount: minor,
    bookAmount: checked(() => bookAmount(money(minor, currency), rate, bookCurrency)).minor,
  };
}

/**
 * Writes the validated lines of a batch into the journal, all or nothing: a line
 * with a sub-category becomes a reconciled entry, a line matched to an entry
 * reconciles it and dates it as the bank does (a side of a transfer keeps its
 * date); a forecast of another amount takes the bank's. Sets the opening balance too when asked.
 */
export async function importBatchLines(
  tx: Tx,
  bookId: string,
  batchId: string,
  request: Omit<ImportRequest, "setOpening"> & { setOpening: boolean },
) {
  const batch = await batchOf(tx, bookId, batchId, true);
  const { currency, archivedAt } = batch.account;
  if (archivedAt) throw bad("The account is archived");
  const lines = await linesOf(tx, batchId);
  const pending = lines.filter((l) => l.status === "validated");
  const opening = request.setOpening ? await openingOf(tx, batch.accountId, lines) : null;
  if (request.setOpening && !opening) {
    throw bad("The opening balance needs a statement balance and no line left to review");
  }
  if (pending.length === 0 && !opening) throw bad("No validated line to import");

  const bookCurrency = await bookCurrencyOf(tx, bookId);
  const rate = checked(() => resolveRate(currency, bookCurrency, request.exchangeRate));
  const inBook = (minor: bigint) =>
    checked(() => bookAmount(money(minor, currency), rate, bookCurrency)).minor;

  let created = 0;
  let matched = 0;
  for (const line of pending) {
    let entryId = line.entryId;
    let previous: {
      previousDate: string;
      previousReconciled: boolean;
      previousAmount: bigint;
      previousMonthShifted: boolean;
    } | null = null;
    if (entryId) {
      const [entry] = await tx
        .select({
          accountId: journalEntry.accountId,
          amount: journalEntry.amount,
          transferId: journalEntry.transferId,
          date: journalEntry.date,
          reconciled: journalEntry.reconciled,
          exchangeRate: journalEntry.exchangeRate,
          monthShifted: journalEntry.monthShifted,
          splitId: journalEntry.splitId,
          splitRemainder: journalEntry.splitRemainder,
        })
        .from(journalEntry)
        .where(and(eq(journalEntry.id, entryId), eq(journalEntry.bookId, bookId)));
      // A split is matched by its remainder, for the bank amount of the whole.
      const bank = entry?.splitId
        ? total((await splitParts(tx, bookId, [entry.splitId])).get(entry.splitId) ?? [])
        : entry?.amount;
      if (
        !entry ||
        (entry.splitId && !entry.splitRemainder) ||
        !lineMayBe(line, batch.accountId, { ...entry, amount: bank! })
      ) {
        throw new HTTPException(409, {
          message: `The entry matched to the line of ${line.date} has changed: review it again`,
        });
      }
      // The parts of a split are reconciled and dated together.
      await tx
        .update(journalEntry)
        .set({
          reconciled: true,
          // Dated by the bank, it stays in the budget month it was planned in.
          ...(entry.transferId
            ? {}
            : {
                date: line.date,
                monthShifted: shiftToKeep(line.date, budgetMonth(entry.date, entry.monthShifted)),
              }),
        })
        .where(
          entry.splitId
            ? and(eq(journalEntry.bookId, bookId), eq(journalEntry.splitId, entry.splitId))
            : eq(journalEntry.id, entryId),
        );
      // A forecast takes the bank's amount, at its own rate; its planned amount stays.
      // In a split the remainder takes the difference: the other parts keep theirs.
      if (bank !== line.amount) {
        await tx
          .update(journalEntry)
          .set(
            amounts(
              entry.amount + (line.amount - bank!),
              currency,
              entry.exchangeRate,
              bookCurrency,
            ),
          )
          .where(eq(journalEntry.id, entryId));
      }
      previous = {
        previousDate: entry.date,
        previousReconciled: entry.reconciled,
        previousAmount: entry.amount,
        previousMonthShifted: entry.monthShifted,
      };
      matched++;
    } else {
      if (!line.subCategoryId) {
        throw new HTTPException(409, {
          message: `The line of ${line.date} has no sub-category or entry: review it again`,
        });
      }
      const description = line.description ?? (line.counterparty || line.label);
      let transferId: string | null = null;
      if (line.transferAccountId) {
        // The other side waits, not reconciled, for the line of the other statement.
        if (!(await usableTransferAccounts(tx, bookId, batch)).has(line.transferAccountId)) {
          throw new HTTPException(409, {
            message: `The account of the transfer of ${line.date} has changed: review it again`,
          });
        }
        const [header] = await tx
          .insert(transfer)
          .values({ bookId, delayDays: 0 })
          .returning({ id: transfer.id });
        transferId = header!.id;
        await tx.insert(journalEntry).values({
          bookId,
          transferId,
          transferLeg: line.amount < 0n ? "destination" : "source",
          date: line.date,
          accountId: line.transferAccountId,
          subCategoryId: line.subCategoryId,
          description: description.slice(0, 500),
          amount: -line.amount,
          plannedAmount: 0n,
          exchangeRate: rate,
          bookAmount: inBook(-line.amount),
          reconciled: false,
        });
      }
      const [entry] = await tx
        .insert(journalEntry)
        .values({
          bookId,
          date: line.date,
          accountId: batch.accountId,
          subCategoryId: line.subCategoryId,
          description: description.slice(0, 500),
          amount: line.amount,
          plannedAmount: 0n,
          exchangeRate: rate,
          bookAmount: inBook(line.amount),
          reconciled: true,
          importBatchId: batch.id,
          ...(transferId
            ? {
                transferId,
                transferLeg: line.amount < 0n ? ("source" as const) : ("destination" as const),
              }
            : {}),
        })
        .returning({ id: journalEntry.id });
      entryId = entry!.id;
      created++;
    }
    await tx
      .update(importLine)
      .set({ status: "imported", entryId, ...previous })
      .where(eq(importLine.id, line.id));
  }

  if (opening) {
    await tx
      .update(bookAccount)
      .set({ openingBalance: opening.proposed, openingBookAmount: inBook(opening.proposed) })
      .where(eq(bookAccount.id, batch.accountId));
  }
  return { created, matched, openingSet: opening !== null };
}

/**
 * Undoes the import of a batch: the entries it created are deleted, the entries it
 * reconciled get their date, amount and flag back, and its lines are validated again, ready
 * to be changed or imported anew. The opening balance is left as it is. An entry
 * the user changed or deleted since is not touched, and counted in `skipped`.
 */
export async function undoImport(tx: Tx, bookId: string, batchId: string) {
  const batch = await batchOf(tx, bookId, batchId, true);
  const lines = (await linesOf(tx, batchId)).filter((l) => l.status === "imported");
  if (lines.length === 0) throw bad("Nothing was imported from this batch");
  const bookCurrency = await bookCurrencyOf(tx, bookId);

  let removed = 0;
  let restored = 0;
  let skipped = 0;
  for (const line of lines) {
    if (line.entryId === null) {
      skipped++;
    } else if (line.previousReconciled === null) {
      // Created by the import: only while it still is what the import wrote.
      const [side] = await tx
        .select({ transferId: journalEntry.transferId })
        .from(journalEntry)
        .where(and(eq(journalEntry.id, line.entryId), eq(journalEntry.bookId, bookId)));
      if (side?.transferId) {
        // A transfer goes with its other side, unless the other statement reconciled it.
        const [other] = await tx
          .select({ id: journalEntry.id })
          .from(journalEntry)
          .where(
            and(
              eq(journalEntry.transferId, side.transferId),
              ne(journalEntry.id, line.entryId),
              eq(journalEntry.reconciled, false),
            ),
          );
        const [own] = await tx
          .select({ id: journalEntry.id })
          .from(journalEntry)
          .where(
            and(
              eq(journalEntry.id, line.entryId),
              eq(journalEntry.importBatchId, batch.id),
              eq(journalEntry.amount, line.amount),
            ),
          );
        const gone = other !== undefined && own !== undefined;
        if (gone) {
          await tx.delete(transfer).where(eq(transfer.id, side.transferId));
          removed++;
        } else skipped++;
        await tx
          .update(importLine)
          .set({
            status: "validated",
            previousDate: null,
            previousReconciled: null,
            previousAmount: null,
            previousMonthShifted: null,
            ...(gone ? { entryId: null } : {}),
          })
          .where(eq(importLine.id, line.id));
        continue;
      }
      const gone = await tx
        .delete(journalEntry)
        .where(
          and(
            eq(journalEntry.id, line.entryId),
            eq(journalEntry.bookId, bookId),
            eq(journalEntry.importBatchId, batch.id),
            eq(journalEntry.amount, line.amount),
          ),
        )
        .returning({ id: journalEntry.id });
      if (gone.length > 0) removed++;
      else skipped++;
    } else {
      const [entry] = await tx
        .select({
          exchangeRate: journalEntry.exchangeRate,
          amount: journalEntry.amount,
          splitId: journalEntry.splitId,
        })
        .from(journalEntry)
        .where(and(eq(journalEntry.id, line.entryId), eq(journalEntry.bookId, bookId)));
      // Still what the import wrote: for a split, the whole movement is the line's amount.
      const bank = entry?.splitId
        ? total((await splitParts(tx, bookId, [entry.splitId])).get(entry.splitId) ?? [])
        : entry?.amount;
      if (entry && bank === line.amount) {
        // The parts of a split are given their date and flag back together.
        await tx
          .update(journalEntry)
          .set({
            reconciled: line.previousReconciled,
            ...(line.previousDate === null ? {} : { date: line.previousDate }),
            ...(line.previousMonthShifted === null
              ? {}
              : { monthShifted: line.previousMonthShifted }),
          })
          .where(
            entry.splitId
              ? and(eq(journalEntry.bookId, bookId), eq(journalEntry.splitId, entry.splitId))
              : eq(journalEntry.id, line.entryId),
          );
        if (line.previousAmount !== null && line.previousAmount !== entry.amount) {
          await tx
            .update(journalEntry)
            .set(
              amounts(
                line.previousAmount,
                batch.account.currency,
                entry.exchangeRate,
                bookCurrency,
              ),
            )
            .where(eq(journalEntry.id, line.entryId));
        }
        restored++;
      } else skipped++;
    }
    // A created entry is gone, its line goes back to choosing a sub-category; a matched one is still the line's entry.
    await tx
      .update(importLine)
      .set({
        status: "validated",
        previousDate: null,
        previousReconciled: null,
        previousAmount: null,
        previousMonthShifted: null,
        ...(line.previousReconciled === null ? { entryId: null } : {}),
      })
      .where(eq(importLine.id, line.id));
  }
  return { removed, restored, skipped };
}

/**
 * Proposes what the book's rules say for the lines of a batch: the first rule that
 * fits sets its sub-category and description, or marks the line to be
 * ignored. It looks at the lines still to review that have no entry and nothing the
 * user typed, so it can be run again after the rules changed: a line a rule had
 * proposed something for is looked at again, and loses the proposal when no rule
 * fits any more. The lines stay to review: the user accepts the proposals. Returns
 * how many lines got a different proposal.
 */
export async function applyRules(tx: Tx, bookId: string, batchId: string) {
  const batch = await batchOf(tx, bookId, batchId);
  const archived = new Set(
    (
      await tx
        .select({ id: subCategory.id })
        .from(subCategory)
        .where(and(eq(subCategory.bookId, bookId), isNotNull(subCategory.archivedAt)))
    ).map((s) => s.id),
  );
  const rules = (
    await tx
      .select()
      .from(importRule)
      .where(eq(importRule.bookId, bookId))
      .orderBy(asc(importRule.position), asc(importRule.createdAt))
  ).filter((rule) => !(rule.subCategoryId && archived.has(rule.subCategoryId)));

  const same = (a: string | null, b: string | null) => a === b;
  const hits = new Map<string, string[]>();
  const cleared: string[] = [];
  for (const line of await linesOf(tx, batchId)) {
    if (line.status !== "review" || line.entryId) continue;
    if (!line.ruleId && (line.subCategoryId || line.description)) continue;
    const rule = firstRule(rules, {
      currency: batch.account.currency,
      amount: line.amount,
      counterparty: line.counterparty,
      label: line.label,
      memo: line.memo,
      bankCategory: line.bankCategory,
    });
    if (!rule) {
      if (line.ruleId) cleared.push(line.id);
    } else if (
      rule.id !== line.ruleId ||
      !same(rule.subCategoryId, line.subCategoryId) ||
      !same(rule.description, line.description)
    ) {
      hits.set(rule.id, [...(hits.get(rule.id) ?? []), line.id]);
    }
  }
  let changed = 0;
  for (const [ruleId, ids] of hits) {
    const rule = rules.find((r) => r.id === ruleId)!;
    await tx
      .update(importLine)
      .set({
        ruleId,
        subCategoryId: rule.subCategoryId,
        description: rule.description,
      })
      .where(inArray(importLine.id, ids));
    changed += ids.length;
  }
  if (cleared.length > 0) {
    await tx
      .update(importLine)
      .set({ ruleId: null, subCategoryId: null, description: null })
      .where(inArray(importLine.id, cleared));
    changed += cleared.length;
  }
  return changed;
}

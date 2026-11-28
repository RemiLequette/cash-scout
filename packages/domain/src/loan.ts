/**
 * Loans (see docs/wealth.md): a loan's schedule is computed from its terms and
 * its dated events, never stored. Amounts are minor units of the currency of
 * the loan's payment account.
 */
import { z } from "zod";
import { versionSchema } from "./book.js";
import { daysBetween, entryDateSchema, positiveAmountSchema, rateSchema } from "./journal.js";

/** The most monthly payments of a loan: 50 years. */
export const maxLoanTerm = 600;

/** What the insurance rate applies to: nothing, the capital borrowed or the remaining capital. */
export const insuranceModes = ["none", "initial", "remaining"] as const;
export type InsuranceMode = (typeof insuranceModes)[number];

/** The first months of a loan: interest only, or nothing paid. */
export const deferralModes = ["none", "interest", "total"] as const;
export type DeferralMode = (typeof deferralModes)[number];

/** A change of insurer is an event too: from its date, the insurance has new terms. */
export const loanEventKinds = ["drawdown", "repayment", "buyback", "insurance"] as const;
export type LoanEventKind = (typeof loanEventKinds)[number];

/** What an early repayment of part of the capital leaves as it was. */
export const repaymentKeeps = ["payment", "term"] as const;
export type RepaymentKeeps = (typeof repaymentKeeps)[number];

/** A yearly rate in percent as text: "3.15". */
export const percentSchema = z
  .string()
  .trim()
  .regex(/^\d{1,2}(\.\d{1,5})?$/, "Invalid rate");

const loanFields = {
  name: z.string().trim().min(1).max(100),
  lender: z.string().trim().max(100).default(""),
  /** Capital borrowed, in the currency of the payment account. */
  amount: positiveAmountSchema,
  /** Yearly nominal rate in percent; a month's interest is a twelfth of it. */
  rate: percentSchema,
  /** Number of monthly payments, deferred ones included. */
  term: z.int().min(1).max(maxLoanTerm),
  /** Date of the first payment. */
  start: entryDateSchema,
  insuranceMode: z.enum(insuranceModes).default("none"),
  /** Yearly rate in percent. */
  insuranceRate: percentSchema.default("0"),
  /** The insurance is its own entry, outside the payment's split. */
  insuranceSeparate: z.boolean().default(false),
  /** Account of a separate insurance; none for the payment account. */
  insuranceAccountId: z.uuid().nullable().default(null),
  /** Sub-category of the penalties of early repayments and buy-backs. */
  penaltySubCategoryId: z.uuid().nullable().default(null),
  deferralMode: z.enum(deferralModes).default("none"),
  deferralMonths: z.int().min(0).max(maxLoanTerm).default(0),
  accountId: z.uuid(),
  capitalSubCategoryId: z.uuid(),
  interestSubCategoryId: z.uuid(),
  insuranceSubCategoryId: z.uuid().nullable().default(null),
};

interface LoanRules {
  term: number;
  insuranceMode: InsuranceMode;
  insuranceSubCategoryId: string | null;
  deferralMode: DeferralMode;
  deferralMonths: number;
}

function checkLoan(loan: LoanRules, context: z.RefinementCtx) {
  const issue = (path: string, message: string) =>
    context.addIssue({ code: "custom", path: [path], message });
  if (loan.insuranceMode !== "none" && !loan.insuranceSubCategoryId) {
    issue("insuranceSubCategoryId", "The insurance needs a sub-category");
  }
  if ((loan.deferralMode === "none") !== (loan.deferralMonths === 0)) {
    issue("deferralMonths", "A deferral needs a number of months");
  }
  if (loan.deferralMonths >= loan.term) {
    issue("deferralMonths", "The deferral must be shorter than the loan");
  }
}

export const loanInputSchema = z.object(loanFields).superRefine(checkLoan);
export type LoanInput = z.input<typeof loanInputSchema>;

/** A loan is changed as a whole. */
export const loanUpdateSchema = z
  .object({ ...loanFields, version: versionSchema.optional() })
  .superRefine(checkLoan);
export type LoanUpdate = z.input<typeof loanUpdateSchema>;

export const loanEventInputSchema = z
  .object({
    date: entryDateSchema,
    kind: z.enum(loanEventKinds),
    /** Capital released or repaid; none repays all that is left. */
    amount: positiveAmountSchema.nullable().default(null),
    keeps: z.enum(repaymentKeeps).default("payment"),
    /** For a change of insurer: the insurance from the date on. */
    insuranceMode: z.enum(insuranceModes).nullable().default(null),
    insuranceRate: percentSchema.default("0"),
    insuranceSeparate: z.boolean().default(false),
    insuranceAccountId: z.uuid().nullable().default(null),
    /** A comment on the event: why, with which bank, what was agreed. */
    note: z.string().trim().max(300).default(""),
    /** A penalty paid with an early repayment or a buy-back: a cost of its own. */
    penalty: positiveAmountSchema.nullable().default(null),
    version: versionSchema.optional(),
  })
  .superRefine((event, context) => {
    const issue = (path: string, message: string) =>
      context.addIssue({ code: "custom", path: [path], message });
    if (event.kind === "drawdown" && event.amount === null) {
      issue("amount", "A drawdown needs an amount");
    }
    if ((event.kind === "buyback" || event.kind === "insurance") && event.amount !== null) {
      issue("amount", "This event has no amount");
    }
    if (event.penalty !== null && event.kind !== "repayment" && event.kind !== "buyback") {
      issue("penalty", "Only a repayment or a buy-back has a penalty");
    }
    if ((event.kind === "insurance") !== (event.insuranceMode !== null)) {
      issue("insuranceMode", "Only a change of insurer has insurance terms");
    }
  });
export type LoanEventInput = z.input<typeof loanEventInputSchema>;

export const loanPlanSchema = z.object({
  year: z.int().min(1900).max(2200),
  /** Required when the payment account is not in the book currency. */
  exchangeRate: rateSchema.optional(),
});
export type LoanPlanInput = z.input<typeof loanPlanSchema>;

export const loanQuerySchema = z.object({
  /** The date the remaining capital is given at. */
  date: entryDateSchema,
});

export interface LoanTerms {
  amount: bigint;
  rate: string;
  term: number;
  start: string;
  insuranceMode: InsuranceMode;
  insuranceRate: string;
  insuranceSeparate: boolean;
  insuranceAccountId: string | null;
  deferralMode: DeferralMode;
  deferralMonths: number;
}

export interface LoanEvent {
  date: string;
  kind: LoanEventKind;
  amount: bigint | null;
  keeps: RepaymentKeeps;
  /** For a change of insurer. */
  insuranceMode?: InsuranceMode | null;
  insuranceRate?: string;
  insuranceSeparate?: boolean;
  insuranceAccountId?: string | null;
  /** Paid with an early repayment or a buy-back, on top of the capital. */
  penalty?: bigint | null;
}

/** One line of a schedule: a monthly payment, or an event. */
export interface LoanLine {
  date: string;
  kind: "payment" | LoanEventKind;
  /** The number of a monthly payment, from 1. */
  number: number | null;
  /** Capital repaid; for a drawdown, capital released. */
  capital: bigint;
  /** For a total deferral, the interest is not paid: it joins the capital. */
  interest: bigint;
  insurance: bigint;
  /** The insurance is not in the payment: it is its own entry, on `insuranceAccountId` (none: the payment account). */
  insuranceSeparate: boolean;
  insuranceAccountId: string | null;
  /** The penalty of an early repayment or a buy-back: its own entry, not part of the total. */
  penalty: bigint;
  /** What leaves the payment account (nothing for a drawdown), the insurance only if it is in the payment. */
  total: bigint;
  /** Capital left to repay after the line. */
  remaining: bigint;
}

/** The same day `months` later, or the month's last day when the month is shorter. */
export function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const at = new Date(Date.UTC(year, month - 1 + months, 1));
  const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0)).getUTCDate();
  at.setUTCDate(Math.min(day, end));
  return at.toISOString().slice(0, 10);
}

/** A share of an amount, rounded to the minor unit. */
const share = (amount: bigint, rate: number) => BigInt(Math.round(Number(amount) * rate));

/** The constant payment (capital and interest) repaying `balance` in `months`. */
export function annuity(balance: bigint, monthlyRate: number, months: number): bigint {
  const payment =
    monthlyRate === 0
      ? Number(balance) / months
      : (Number(balance) * monthlyRate) / (1 - (1 + monthlyRate) ** -months);
  return BigInt(Math.round(payment));
}

const smallest = (a: bigint, b: bigint) => (a < b ? a : b);

/** The capital there is to repay before any payment or event. */
const openingCapital = (loan: LoanTerms, events: readonly LoanEvent[]) =>
  events.some((event) => event.kind === "drawdown") ? 0n : loan.amount;

/**
 * The schedule of a loan, as a French constant-payment loan: each month the
 * interest is a twelfth of the yearly rate on the capital left, and the rest of
 * the payment repays capital. The last payment takes what is left.
 *
 * Without drawdowns the whole amount is released at the start; with them, only
 * what they release. An event counts after the payments of its date and before
 * the next one. A drawdown, or a repayment keeping the term, sets a new
 * payment; a repayment keeping the payment shortens the loan.
 */
export function loanSchedule(loan: LoanTerms, events: readonly LoanEvent[]): LoanLine[] {
  const monthly = Number(loan.rate) / 1200;
  let insurance = {
    mode: loan.insuranceMode,
    rate: loan.insuranceMode === "none" ? 0 : Number(loan.insuranceRate) / 1200,
    separate: loan.insuranceSeparate && loan.insuranceMode !== "none",
    accountId: loan.insuranceAccountId,
  };
  const deferred = loan.deferralMode === "none" ? 0 : loan.deferralMonths;
  // A change of insurer counts from its date: for the payments of that day on.
  const insurers = events
    .filter((event) => event.kind === "insurance")
    .sort((a, b) => a.date.localeCompare(b.date));
  // Events of one day keep their order, drawdowns first.
  const pending = events
    .filter((event) => event.kind !== "insurance")
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        Number(b.kind === "drawdown") - Number(a.kind === "drawdown"),
    );
  const lines: LoanLine[] = [];
  let balance = openingCapital(loan, events);
  let payment: bigint | null = null;
  let next = 0;
  let over = false;

  /** Applies the events dated before `date`; all of them without a date. */
  const applyEvents = (date?: string) => {
    while (!over && next < pending.length && (!date || pending[next]!.date < date)) {
      const event = pending[next++]!;
      const line = {
        date: event.date,
        kind: event.kind,
        number: null,
        interest: 0n,
        insurance: 0n,
        insuranceSeparate: false,
        insuranceAccountId: null,
        penalty: 0n,
      };
      if (event.kind === "drawdown") {
        balance += event.amount ?? 0n;
        payment = null;
        lines.push({ ...line, capital: event.amount ?? 0n, total: 0n, remaining: balance });
        continue;
      }
      const repaid = event.amount === null ? balance : smallest(event.amount, balance);
      if (repaid <= 0n) continue;
      balance -= repaid;
      if (event.keeps === "term") payment = null;
      lines.push({
        ...line,
        capital: repaid,
        total: repaid,
        penalty: event.penalty ?? 0n,
        remaining: balance,
      });
      // Repaid in full, unless more is still to be released.
      over = balance === 0n && !pending.slice(next).some((later) => later.kind === "drawdown");
    }
  };

  for (let number = 1; number <= loan.term && !over; number++) {
    const date = addMonths(loan.start, number - 1);
    applyEvents(date);
    if (over) break;
    while (insurers.length > 0 && insurers[0]!.date <= date) {
      const change = insurers.shift()!;
      const mode = change.insuranceMode ?? "none";
      insurance = {
        mode,
        rate: mode === "none" ? 0 : Number(change.insuranceRate ?? "0") / 1200,
        separate: (change.insuranceSeparate ?? false) && mode !== "none",
        accountId: change.insuranceAccountId ?? null,
      };
      lines.push({
        date: change.date,
        kind: "insurance",
        number: null,
        capital: 0n,
        interest: 0n,
        insurance: 0n,
        insuranceSeparate: false,
        insuranceAccountId: null,
        penalty: 0n,
        total: 0n,
        remaining: balance,
      });
    }
    const interest = share(balance, monthly);
    const insured = share(insurance.mode === "initial" ? loan.amount : balance, insurance.rate);
    let capital = 0n;
    if (number <= deferred) {
      if (loan.deferralMode === "total") {
        balance += interest;
        lines.push({
          date,
          kind: "payment",
          number,
          capital: 0n,
          interest,
          insurance: 0n,
          insuranceSeparate: false,
          insuranceAccountId: null,
          penalty: 0n,
          total: 0n,
          remaining: balance,
        });
        continue;
      }
    } else if (balance > 0n) {
      payment ??= annuity(balance, monthly, loan.term - number + 1);
      capital = payment - interest;
      if (number === loan.term || capital >= balance) capital = balance;
      else if (capital < 0n) capital = 0n;
    }
    balance -= capital;
    lines.push({
      date,
      kind: "payment",
      number,
      capital,
      interest,
      insurance: insured,
      insuranceSeparate: insurance.separate,
      insuranceAccountId: insurance.accountId,
      penalty: 0n,
      total: capital + interest + (insurance.separate ? 0n : insured),
      remaining: balance,
    });
    if (capital > 0n && balance === 0n) {
      over = !pending.slice(next).some((later) => later.kind === "drawdown");
    }
  }
  applyEvents();
  // Insurer changes and events were pushed as the payments went: back in order of day.
  return lines.sort((a, b) => a.date.localeCompare(b.date));
}

/** The yearly rate, in percent, that makes what is received worth what is paid; none if there is none. */
function actuarialRate(flows: readonly { date: string; amount: number }[]): number | null {
  if (flows.length < 2) return null;
  const first = flows[0]!.date;
  const value = (rate: number) =>
    flows.reduce(
      (sum, flow) => sum + flow.amount * (1 + rate) ** (-daysBetween(first, flow.date) / 365),
      0,
    );
  let low = -0.9;
  let high = 10;
  if (value(low) * value(high) > 0) return null;
  for (let step = 0; step < 200; step++) {
    const middle = (low + high) / 2;
    // The money received comes first, and what is paid is worth less as the rate rises.
    if (value(middle) > 0) high = middle;
    else low = middle;
  }
  return ((low + high) / 2) * 100;
}

/**
 * The effective yearly rate of a loan as contracted (TEG): with and without
 * the insurance, an insurance paid apart included. Only the drawdowns are
 * kept of the events, and the money is taken to be released a month before the
 * first payment, when it is not drawn in steps. In percent.
 */
export function effectiveRates(
  loan: LoanTerms,
  events: readonly LoanEvent[],
): { withInsurance: number | null; withoutInsurance: number | null } {
  const drawdowns = events.filter((event) => event.kind === "drawdown");
  const lines = loanSchedule(loan, drawdowns);
  const received =
    drawdowns.length > 0
      ? lines
          .filter((line) => line.kind === "drawdown")
          .map((line) => ({ date: line.date, amount: Number(line.capital) }))
      : [{ date: addMonths(loan.start, -1), amount: Number(loan.amount) }];
  const paid = lines.filter((line) => line.kind === "payment");
  const flows = (withInsurance: boolean) =>
    [
      ...received,
      ...paid.map((line) => {
        // The total holds the insurance only when it is in the payment.
        const without = line.total - (line.insuranceSeparate ? 0n : line.insurance);
        const amount = withInsurance ? without + (line.total > 0n ? line.insurance : 0n) : without;
        return { date: line.date, amount: -Number(amount) };
      }),
    ].sort((a, b) => a.date.localeCompare(b.date));
  return {
    withInsurance: actuarialRate(flows(true)),
    withoutInsurance: actuarialRate(flows(false)),
  };
}

/** The capital left to repay at the end of a day. */
export function remainingCapital(
  loan: LoanTerms,
  events: readonly LoanEvent[],
  date: string,
): bigint {
  let remaining = openingCapital(loan, events);
  for (const line of loanSchedule(loan, events)) {
    if (line.date > date) break;
    remaining = line.remaining;
  }
  return remaining;
}

/**
 * The lines of a schedule that move money on the payment account: the monthly
 * payments and the early repayments. A buy-back is paid by the new lender, and
 * a drawdown goes to the seller.
 */
export function paidLines(lines: readonly LoanLine[]): LoanLine[] {
  return lines.filter(
    (line) => line.total > 0n && (line.kind === "payment" || line.kind === "repayment"),
  );
}

/** The monthly payments whose insurance is its own entry, outside the payment's split. */
export function insuranceLines(lines: readonly LoanLine[]): LoanLine[] {
  return lines.filter(
    (line) => line.kind === "payment" && line.insuranceSeparate && line.insurance > 0n,
  );
}

/** The early repayments and buy-backs that carry a penalty, paid on the payment account. */
export function penaltyLines(lines: readonly LoanLine[]): LoanLine[] {
  return lines.filter((line) => line.penalty > 0n);
}

/** How far apart a payment and its journal entry may be and still be the same one. */
const SAME_PAYMENT_DAYS = 20;

/**
 * Pairs scheduled payments with what the journal already holds, by date: each
 * item takes the closest line still free. Returns, for each line, the index of
 * its item or undefined.
 */
export function matchPayments(
  lines: readonly { date: string; total?: bigint }[],
  items: readonly { date: string; total?: bigint }[],
  days = SAME_PAYMENT_DAYS,
): (number | undefined)[] {
  const pairs = items
    .flatMap((item, at) =>
      lines.map((line, to) => ({
        at,
        to,
        apart: Math.abs(daysBetween(line.date, item.date)),
        // On the same day, the closest amount: a payment and a repayment may share it.
        differs: Math.abs(Number((line.total ?? 0n) - (item.total ?? 0n))),
      })),
    )
    .filter((pair) => pair.apart <= days)
    .sort((a, b) => a.apart - b.apart || a.differs - b.differs || a.to - b.to);
  const found: (number | undefined)[] = lines.map(() => undefined);
  const used = new Set<number>();
  for (const { at, to } of pairs) {
    if (found[to] !== undefined || used.has(at)) continue;
    found[to] = at;
    used.add(at);
  }
  return found;
}

export interface CapitalCheck {
  /** The months compared, "2026-01". */
  from: string;
  to: string;
  /** Capital repaid over them according to the schedule, and in the journal. */
  schedule: bigint;
  journal: bigint;
}

/**
 * Compares the capital repaid in the journal with the schedules that share its
 * sub-category, over the months the journal covers: from the first month with
 * an entry (the loan may be older than the journal) to the month of
 * `through`, the last day the journal is reconciled to, which counts only once
 * it holds an entry. None when there is nothing to compare.
 */
export function checkCapital(
  lines: readonly LoanLine[],
  entries: readonly { date: string; amount: bigint }[],
  through: string,
): CapitalCheck | undefined {
  // A buy-back is paid by the new lender: nothing of it is in the journal.
  const due = paidLines(lines).filter((line) => line.capital > 0n);
  const repaid = entries.filter((entry) => entry.date <= through);
  const month = (date: string) => date.slice(0, 7);
  const first = repaid.map((entry) => entry.date).sort()[0];
  const start = lines.map((line) => line.date).sort()[0];
  if (!first || !start) return undefined;
  const from = month(first > start ? first : start);
  const last = month(through);
  const holds = repaid.some((entry) => month(entry.date) === last);
  const to = holds ? last : month(addMonths(`${last}-01`, -1));
  if (to < from) return undefined;
  const within = (date: string) => month(date) >= from && month(date) <= to;
  const total = (amounts: bigint[]) => amounts.reduce((sum, amount) => sum + amount, 0n);
  return {
    from,
    to,
    schedule: total(due.filter((line) => within(line.date)).map((line) => line.capital)),
    // Money leaving the account is negative: capital repaid is its negation.
    journal: -total(repaid.filter((entry) => within(entry.date)).map((entry) => entry.amount)),
  };
}

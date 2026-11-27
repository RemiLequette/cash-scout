import { z } from "zod";
import { currencySchema, versionSchema } from "./book.js";
import { convert, currencyDigits, money, type Money } from "./money.js";

/**
 * Journal entries (see README, Journal).
 *
 * Amounts travel as decimal text with a dot ("-12.50"), checked against the
 * account currency by the API. The sign is kept as entered, and nothing here
 * compares it with the category.
 */

/** Decimal amount as text, signed: "-12.50", "1500". */
export const amountTextSchema = z
  .string()
  .trim()
  .regex(/^[+-]?\d+(\.\d+)?$/, "Invalid amount");

/**
 * Calendar date, "2026-11-22". Year and month are derived from it, never stored;
 * see budget-month.ts for the month an entry counts in.
 */
export const entryDateSchema = z.iso.date();

/**
 * Exchange rate as text: 1 unit of the account currency = rate units of the
 * book currency. Positive, at most 10 decimals.
 */
export const rateSchema = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,10})?$/, "Invalid exchange rate")
  .refine((rate) => /[1-9]/.test(rate), "The exchange rate must be above zero");

const descriptionSchema = z.string().trim().max(500);

export const entryInputSchema = z
  .object({
    date: entryDateSchema,
    accountId: z.uuid(),
    subCategoryId: z.uuid(),
    description: descriptionSchema.default(""),
    /** Signed, in the account's currency. */
    amount: amountTextSchema,
    /** Required when the account currency is not the book currency. */
    exchangeRate: rateSchema.optional(),
    /** For information only: the amount and currency actually paid. */
    originalAmount: amountTextSchema.nullable().optional(),
    originalCurrency: currencySchema.nullable().optional(),
    reconciled: z.boolean().optional(),
    /** Counts in the budget of the month before or after its date's (see budget-month.ts). */
    monthShifted: z.boolean().optional(),
    /**
     * Part of the budget's plan: the planned amount is then the amount. An entry
     * made in the journal is not planned, and its planned amount is 0.
     */
    planned: z.boolean().optional(),
  })
  .refine((e) => (e.originalAmount == null) === (e.originalCurrency == null), {
    message: "The original amount and its currency go together",
    path: ["originalCurrency"],
  });
export type EntryInput = z.input<typeof entryInputSchema>;

/**
 * Any field of an entry. Its planned amount only changes from the budget's plan,
 * with `planned`: it then becomes the amount.
 */
export const entryUpdateSchema = z
  .object({
    date: entryDateSchema,
    accountId: z.uuid(),
    subCategoryId: z.uuid(),
    description: descriptionSchema,
    amount: amountTextSchema,
    exchangeRate: rateSchema,
    originalAmount: amountTextSchema.nullable(),
    originalCurrency: currencySchema.nullable(),
    reconciled: z.boolean(),
    monthShifted: z.boolean(),
    planned: z.boolean(),
    version: versionSchema,
  })
  .partial()
  .refine(
    (e) =>
      e.originalAmount === undefined && e.originalCurrency === undefined
        ? true
        : (e.originalAmount == null) === (e.originalCurrency == null),
    { message: "The original amount and its currency go together", path: ["originalCurrency"] },
  );
export type EntryUpdate = z.input<typeof entryUpdateSchema>;

/** Positive decimal amount as text: the size of a transfer, whose sign comes from its side. */
export const positiveAmountSchema = amountTextSchema
  .regex(/^\+?\d+(\.\d+)?$/, "The amount must be positive")
  .refine((amount) => /[1-9]/.test(amount), "The amount must be above zero");

/** The longest delay between the two sides of a transfer, in days. */
export const maxTransferDelay = 60;

const transferFields = {
  /** The date of the source entry; the destination is credited `delayDays` later. */
  date: entryDateSchema,
  delayDays: z.number().int().min(0).max(maxTransferDelay),
  sourceAccountId: z.uuid(),
  destinationAccountId: z.uuid(),
  subCategoryId: z.uuid(),
  description: descriptionSchema,
  /** Leaving the source account, in its currency. */
  amount: positiveAmountSchema,
  /** Reaching the destination account, in its currency; the amount when both have the same one. */
  destinationAmount: positiveAmountSchema,
  /** Rates of each side into the book currency, required for an account in another currency. */
  sourceRate: rateSchema,
  destinationRate: rateSchema,
};

/** Creating a transfer: the two sides of it are made together. */
export const transferInputSchema = z
  .object({
    ...transferFields,
    delayDays: transferFields.delayDays.default(0),
    description: transferFields.description.default(""),
    destinationAmount: transferFields.destinationAmount.optional(),
    sourceRate: transferFields.sourceRate.optional(),
    destinationRate: transferFields.destinationRate.optional(),
    /** Part of the budget's plan: the planned amounts are then the amounts. */
    planned: z.boolean().optional(),
  })
  .refine((t) => t.sourceAccountId !== t.destinationAccountId, {
    message: "A transfer needs two different accounts",
    path: ["destinationAccountId"],
  });
export type TransferInput = z.input<typeof transferInputSchema>;

/** Changing a transfer changes both of its sides. */
export const transferUpdateSchema = z
  // `planned`: written in the budget's plan, the planned amounts become the amounts.
  .object({ ...transferFields, version: versionSchema, planned: z.boolean() })
  .partial()
  .refine(
    (t) =>
      t.sourceAccountId === undefined ||
      t.destinationAccountId === undefined ||
      t.sourceAccountId !== t.destinationAccountId,
    { message: "A transfer needs two different accounts", path: ["destinationAccountId"] },
  );
export type TransferUpdate = z.input<typeof transferUpdateSchema>;

const compensationFields = {
  date: entryDateSchema,
  description: descriptionSchema,
  /** Receives the amount. */
  plusSubCategoryId: z.uuid(),
  /** Receives its negation. */
  minusSubCategoryId: z.uuid(),
  /** In the book currency. */
  amount: positiveAmountSchema,
};

const differentSides = {
  message: "A compensation needs two different sub-categories",
  path: ["minusSubCategoryId"],
};

/** Creating a compensation: its two sides are made together (see docs/compensations.md). */
export const compensationInputSchema = z
  .object({ ...compensationFields, description: descriptionSchema.default("") })
  .refine((c) => c.plusSubCategoryId !== c.minusSubCategoryId, differentSides);
export type CompensationInput = z.input<typeof compensationInputSchema>;

/** Changing a compensation changes both of its sides. */
export const compensationUpdateSchema = z
  .object({ ...compensationFields, version: versionSchema })
  .partial()
  .refine(
    (c) => c.plusSubCategoryId === undefined || c.plusSubCategoryId !== c.minusSubCategoryId,
    differentSides,
  );
export type CompensationUpdate = z.input<typeof compensationUpdateSchema>;

/** A calendar date moved by a number of days ("2026-11-30" + 2 = "2026-12-02"). */
export function addDays(date: string, days: number): string {
  const moved = new Date(`${date}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

/** Days from one calendar date to another (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Marks several entries reconciled or not at once. */
export const reconcileSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(1000),
  reconciled: z.boolean(),
});

/** Filters of the journal list. Dates are inclusive. */
export const journalQuerySchema = z.object({
  from: entryDateSchema.optional(),
  to: entryDateSchema.optional(),
  accountId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  subCategoryId: z.uuid().optional(),
  /** Only these sub-categories, comma-separated; an empty list matches no entry. */
  subCategoryIds: z
    .string()
    .transform((text) => (text === "" ? [] : text.split(",")))
    .pipe(z.array(z.uuid()).max(1000))
    .optional(),
  /** Only these budget months ("2026-11"), comma-separated; an empty list matches no entry. */
  months: z
    .string()
    .transform((text) => (text === "" ? [] : text.split(",")))
    .pipe(z.array(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)).max(1200))
    .optional(),
  reconciled: z.enum(["true", "false"]).optional(),
  /** Only the sides of compensations. */
  compensations: z.literal("true").optional(),
  /** Text contained in the description, ignoring case. */
  q: z.string().trim().max(100).optional(),
  /** Up to a few years of a household's entries in one page. */
  limit: z.coerce.number().int().min(1).max(2000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type JournalQuery = z.input<typeof journalQuerySchema>;

/**
 * The window of the account projection: daily balances from `from` to `to`.
 * `today` tells which month-end budget lines are still ahead.
 */
export const projectionQuerySchema = z.object({
  from: entryDateSchema,
  to: entryDateSchema,
  today: entryDateSchema,
});

/** Merges a sub-category into another one of the same book. */
export const mergeSchema = z.object({ targetId: z.uuid() });

/**
 * The rate to store for an entry: 1 when the account is in the book currency,
 * else the given rate, which is then required.
 */
export function resolveRate(
  accountCurrency: string,
  bookCurrency: string,
  rate: string | undefined,
): string {
  if (accountCurrency === bookCurrency) {
    return "1";
  }
  if (rate === undefined || !rateSchema.safeParse(rate).success) {
    throw new RangeError(`An exchange rate from ${accountCurrency} to ${bookCurrency} is required`);
  }
  return rate.trim();
}

/** The entry's amount in the book currency, at the entry's rate. */
export function bookAmount(amount: Money, rate: string, bookCurrency: string): Money {
  return amount.currency === bookCurrency ? amount : convert(amount, rate, bookCurrency);
}

/**
 * The rate that turns `amount` into `inBook` (book currency), with 10 decimals,
 * for imports that give both amounts instead of a rate.
 */
export function rateBetween(amount: Money, inBook: Money): string {
  if (amount.minor === 0n) {
    if (inBook.minor !== 0n) {
      throw new RangeError("A zero amount cannot have a book amount");
    }
    return "1";
  }
  if (amount.minor < 0n !== inBook.minor < 0n && inBook.minor !== 0n) {
    throw new RangeError("The amount and the book amount must have the same sign");
  }
  const abs = (v: bigint) => (v < 0n ? -v : v);
  const scale = 10n ** 10n;
  // rate = (inBook / 10^bookDigits) / (amount / 10^accountDigits), rounded to 10 decimals.
  const numerator = abs(inBook.minor) * 10n ** BigInt(currencyDigits(amount.currency)) * scale;
  const denominator = abs(amount.minor) * 10n ** BigInt(currencyDigits(inBook.currency));
  const units = (numerator + denominator / 2n) / denominator;
  const whole = units / scale;
  const fraction = (units % scale).toString().padStart(10, "0").replace(/0+$/, "");
  const rate = fraction ? `${whole}.${fraction}` : `${whole}`;
  if (!rateSchema.safeParse(rate).success) {
    throw new RangeError(`The amounts give an invalid exchange rate: ${rate}`);
  }
  return rate;
}

/** Variance of an entry: amount − planned amount. */
export function variance(amount: Money, planned: Money): Money {
  if (amount.currency !== planned.currency) {
    throw new RangeError("The amount and the planned amount must be in the same currency");
  }
  return money(amount.minor - planned.minor, amount.currency);
}

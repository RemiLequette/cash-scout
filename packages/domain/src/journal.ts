import { z } from "zod";
import { currencySchema, versionSchema } from "./book.js";
import { convert, currencyDigits, money, type Money } from "./money.js";

/**
 * Journal entries (see README, Journal).
 *
 * Amounts travel as decimal text with a dot ("-12.50"), checked against the
 * account currency by the API. The sign is kept as entered: whether an amount
 * is spending or income comes from the category's direction, never from the
 * sign, so nothing here compares the sign with the category.
 */

/** Decimal amount as text, signed: "-12.50", "1500". */
export const amountTextSchema = z
  .string()
  .trim()
  .regex(/^[+-]?\d+(\.\d+)?$/, "Invalid amount");

/** Calendar date, "2026-11-22". Year and month are derived from it, never stored. */
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
    paymentTypeId: z.uuid().nullable().optional(),
    /** Signed, in the account's currency. Also becomes the planned amount. */
    amount: amountTextSchema,
    /** Required when the account currency is not the book currency. */
    exchangeRate: rateSchema.optional(),
    /** For information only: the amount and currency actually paid. */
    originalAmount: amountTextSchema.nullable().optional(),
    originalCurrency: currencySchema.nullable().optional(),
    reconciled: z.boolean().optional(),
  })
  .refine((e) => (e.originalAmount == null) === (e.originalCurrency == null), {
    message: "The original amount and its currency go together",
    path: ["originalCurrency"],
  });
export type EntryInput = z.input<typeof entryInputSchema>;

/** Any field of an entry except its planned amount, which never changes. */
export const entryUpdateSchema = z
  .object({
    date: entryDateSchema,
    accountId: z.uuid(),
    subCategoryId: z.uuid(),
    description: descriptionSchema,
    paymentTypeId: z.uuid().nullable(),
    amount: amountTextSchema,
    exchangeRate: rateSchema,
    originalAmount: amountTextSchema.nullable(),
    originalCurrency: currencySchema.nullable(),
    reconciled: z.boolean(),
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
  /** Only these months ("2026-11"), comma-separated; an empty list matches no entry. */
  months: z
    .string()
    .transform((text) => (text === "" ? [] : text.split(",")))
    .pipe(z.array(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)).max(1200))
    .optional(),
  reconciled: z.enum(["true", "false"]).optional(),
  /** Text contained in the description, ignoring case. */
  q: z.string().trim().max(100).optional(),
  /** Up to a few years of a household's entries in one page. */
  limit: z.coerce.number().int().min(1).max(2000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type JournalQuery = z.input<typeof journalQuerySchema>;

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

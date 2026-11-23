import { z } from "zod";
import { currencySchema, languageSchema, versionSchema } from "./book.js";
import { parseAmount } from "./money.js";

/** Names of a reference item, one per book language: { fr: "Alimentation", en: "Food" }. */
export const namesSchema = z.record(languageSchema, z.string().trim().min(1).max(100));
export type Names = z.infer<typeof namesSchema>;

/**
 * Name to show: in the reader's language, else the book's default language,
 * else any name the item has.
 */
export function displayName(names: Names, language: string, defaultLanguage: string): string {
  const base = language.split("-")[0] ?? language;
  return names[language] ?? names[base] ?? names[defaultLanguage] ?? Object.values(names)[0] ?? "";
}

/** Checks that names use only the book's languages and include its default language. */
export function checkNames(
  names: Names,
  languages: readonly string[],
  defaultLanguage: string,
): string | undefined {
  const unknown = Object.keys(names).filter((language) => !languages.includes(language));
  if (unknown.length > 0) {
    return `Languages not in the book: ${unknown.join(", ")}`;
  }
  if (!names[defaultLanguage]) {
    return `A name in the default language (${defaultLanguage}) is required`;
  }
  return undefined;
}

export const directions = ["expense", "income", "transfer"] as const;
export const directionSchema = z.enum(directions);
export type Direction = z.infer<typeof directionSchema>;

/** Scheduled: the plan is future journal entries. Periodic: an annual amount spread over months. */
export const budgetTypes = ["scheduled", "periodic"] as const;
export const budgetTypeSchema = z.enum(budgetTypes);
export type BudgetType = z.infer<typeof budgetTypeSchema>;

export const accountKinds = ["bank", "virtual"] as const;
export const accountKindSchema = z.enum(accountKinds);
export type AccountKind = z.infer<typeof accountKindSchema>;

/** Category code: sets the sort order, e.g. "C01", "P02". */
export const categoryCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(10)
  .regex(/^[A-Za-z0-9._-]+$/);

const archived = z.boolean();

export const groupInputSchema = z.object({
  names: namesSchema,
  position: z.number().int().min(0).max(10_000).optional(),
});
export const groupUpdateSchema = groupInputSchema
  .partial()
  .extend({ archived: archived.optional(), version: versionSchema.optional() });

export const categoryInputSchema = z.object({
  groupId: z.uuid(),
  code: categoryCodeSchema,
  direction: directionSchema,
  /** Budget type of a year not yet budgeted; periodic when omitted. */
  defaultBudgetType: budgetTypeSchema.optional(),
  names: namesSchema,
});
export const categoryUpdateSchema = categoryInputSchema
  .partial()
  .extend({ archived: archived.optional(), version: versionSchema.optional() });

export const subCategoryInputSchema = z.object({
  categoryId: z.uuid(),
  names: namesSchema,
});
export const subCategoryUpdateSchema = subCategoryInputSchema
  .partial()
  .extend({ archived: archived.optional(), version: versionSchema.optional() });

export const paymentTypeInputSchema = z.object({ names: namesSchema });
export const paymentTypeUpdateSchema = paymentTypeInputSchema
  .partial()
  .extend({ archived: archived.optional(), version: versionSchema.optional() });

/** Decimal amount as text ("-500.00"), checked against the account currency by the API. */
const decimalSchema = z.string().regex(/^[+-]?\d+(\.\d+)?$/);

export const accountInputSchema = z.object({
  names: namesSchema,
  kind: accountKindSchema,
  currency: currencySchema,
  /** Warn when the projected balance goes below this amount (bank accounts). */
  lowBalanceThreshold: decimalSchema.nullable().optional(),
});
/** Kind and currency are fixed at creation. */
export const accountUpdateSchema = accountInputSchema
  .pick({ names: true, lowBalanceThreshold: true })
  .partial()
  .extend({ archived: archived.optional(), version: versionSchema.optional() });

/** Parses a threshold for an account currency into minor units, or null. */
export function parseThreshold(value: string | null | undefined, currency: string): bigint | null {
  return value == null || value === "" ? null : parseAmount(value, currency).minor;
}

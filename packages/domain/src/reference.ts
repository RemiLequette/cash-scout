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

/** Category code: sets the sort order, e.g. "C01", "P02". */
export const categoryCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(10)
  .regex(/^[A-Za-z0-9._-]+$/);

const archived = z.boolean();

/** Colours a group can take in the dashboard: the palette's names, gray left out. */
export const groupColors = [
  "red",
  "pink",
  "grape",
  "violet",
  "indigo",
  "blue",
  "cyan",
  "teal",
  "green",
  "lime",
  "yellow",
  "orange",
] as const;
export const groupColorSchema = z.enum(groupColors);
export type GroupColor = z.infer<typeof groupColorSchema>;

export const groupInputSchema = z.object({
  names: namesSchema,
  /** Order among the groups of the same parent. */
  position: z.number().int().min(0).max(10_000).optional(),
  /** The group this one belongs to; null or omitted for a top-level group. */
  parentId: z.uuid().nullable().optional(),
  /** Colour in the dashboard; null to take the parent's. */
  color: groupColorSchema.nullable().optional(),
});
export const groupUpdateSchema = groupInputSchema
  .partial()
  .extend({ archived: archived.optional(), version: versionSchema.optional() });

/** Sets the order of sibling groups: their ids, first to last. */
export const groupOrderSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(500),
});

/**
 * Whether making `parentId` the parent of group `id` would put a group inside
 * itself, given each group's current parent.
 */
export function makesCycle(
  id: string,
  parentId: string | null | undefined,
  parents: ReadonlyMap<string, string | null>,
): boolean {
  const seen = new Set<string>();
  for (let at = parentId ?? null; at !== null; at = parents.get(at) ?? null) {
    if (at === id) return true;
    if (seen.has(at)) return true;
    seen.add(at);
  }
  return false;
}

/**
 * How a nature reads: +1 as entered (income), -1 reversed so that spending
 * reads as a positive number. It applies to the dashboard and to the budgets.
 */
export const natureSigns = [1, -1] as const;
export const natureSignSchema = z.union([z.literal(1), z.literal(-1)]);
export type NatureSign = z.infer<typeof natureSignSchema>;

/**
 * A nature of a book's flows ("Revenus", "Dépenses", "Exceptionnel"…): a
 * name and the sign it reads with. A transfer nature holds the movements
 * between the book's own accounts: they stay out of the dashboard and are the
 * only ones a transfer can use.
 */
export const natureInputSchema = z.object({
  names: namesSchema,
  sign: natureSignSchema,
  transfer: z.boolean().optional(),
});
export const natureUpdateSchema = natureInputSchema
  .partial()
  .extend({ archived: archived.optional(), version: versionSchema.optional() });

/** An analytic balance: the sum of the entries of some natures, shown in the dashboard. */
export const balanceInputSchema = z.object({
  names: namesSchema,
  natureIds: z.array(z.uuid()).min(1).max(50),
});
export const balanceUpdateSchema = balanceInputSchema
  .partial()
  .extend({ archived: archived.optional(), version: versionSchema.optional() });

/** The natures and balances of a book form one list, in this order. */
export const lineKinds = ["nature", "balance"] as const;
export const lineOrderSchema = z.object({
  items: z
    .array(z.object({ kind: z.enum(lineKinds), id: z.uuid() }))
    .min(1)
    .max(500),
});

/** The natures a new book starts with, named in the book's languages. */
export function defaultNatures(
  languages: readonly string[],
  defaultLanguage: string,
): { names: Names; sign: NatureSign; transfer: boolean }[] {
  const titles: Record<string, [string, string, string, string]> = {
    fr: ["Revenus", "Dépenses", "Épargne", "Transferts"],
    en: ["Income", "Expenses", "Savings", "Transfers"],
  };
  const known = (language: string) => titles[language.split("-")[0] ?? language];
  const fallback = known(defaultLanguage) ?? titles.en!;
  const shapes: [NatureSign, boolean][] = [
    [1, false],
    [-1, false],
    [-1, false],
    [1, true],
  ];
  const wanted = languages.includes(defaultLanguage) ? languages : [defaultLanguage, ...languages];
  return shapes.map(([sign, transfer], index) => ({
    sign,
    transfer,
    names: Object.fromEntries(
      wanted.map((language) => [language, (known(language) ?? fallback)[index]!]),
    ),
  }));
}

export const categoryInputSchema = z.object({
  groupId: z.uuid(),
  code: categoryCodeSchema,
  natureId: z.uuid(),
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

/** Decimal amount as text ("-500.00"), checked against the account currency by the API. */
const decimalSchema = z.string().regex(/^[+-]?\d+(\.\d+)?$/);

export const accountInputSchema = z.object({
  names: namesSchema,
  currency: currencySchema,
  /** Warn when the projected balance goes below this amount. */
  lowBalanceThreshold: decimalSchema.nullable().optional(),
});
/** The currency is fixed at creation. */
export const accountUpdateSchema = accountInputSchema
  .pick({ names: true, lowBalanceThreshold: true })
  .partial()
  .extend({ archived: archived.optional(), version: versionSchema.optional() });

/** Parses a threshold for an account currency into minor units, or null. */
export function parseThreshold(value: string | null | undefined, currency: string): bigint | null {
  return value == null || value === "" ? null : parseAmount(value, currency).minor;
}

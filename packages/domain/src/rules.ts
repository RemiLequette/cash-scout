import { z } from "zod";
import { parseAmount } from "./money.js";

/**
 * Import rules (see docs/bank-import.md): a rule says what to do with the
 * statement lines that fit its conditions. They are tried in order and the first
 * that fits wins. A rule never picks a sub-category from the sign alone: the
 * direction is a condition among others, and the sub-category is the user's.
 */

/** Text as compared by rules: lower case, no accents, single spaces. */
export function normaliseText(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

export const ruleDirections = ["any", "in", "out"] as const;

const unsigned = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, "Invalid amount");

/** A blank text means "no condition". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

export const ruleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    /** The line's counterparty, label or memo contains this text. */
    text: optionalText(100),
    /** The bank's own category contains this text. */
    bankCategory: optionalText(100),
    accountId: z
      .uuid()
      .nullish()
      .transform((value) => value ?? null),
    /** `in` is money received, `out` money spent. */
    direction: z.enum(ruleDirections).default("any"),
    /** Bounds on the size of the amount, sign ignored, in the account's currency. */
    minAmount: unsigned.nullish().transform((value) => value ?? null),
    maxAmount: unsigned.nullish().transform((value) => value ?? null),
    /** The sub-category the line is proposed. */
    subCategoryId: z
      .uuid()
      .nullish()
      .transform((value) => value ?? null),
    /** The payment type (card, transfer, cash...) of the entry. */
    paymentTypeId: z
      .uuid()
      .nullish()
      .transform((value) => value ?? null),
    /** The description of the entry, instead of the bank's counterparty. */
    description: optionalText(500),
    /** The line is proposed to be ignored. */
    ignore: z.boolean().default(false),
  })
  .refine(
    (r) =>
      r.text !== null ||
      r.bankCategory !== null ||
      r.accountId !== null ||
      r.direction !== "any" ||
      r.minAmount !== null ||
      r.maxAmount !== null,
    { message: "A rule needs at least one condition", path: ["text"] },
  )
  .refine(
    (r) =>
      r.ignore || r.subCategoryId !== null || r.paymentTypeId !== null || r.description !== null,
    {
      message:
        "A rule needs an action: a sub-category, a payment type, a description, or ignoring the line",
      path: ["subCategoryId"],
    },
  )
  .refine((r) => !(r.ignore && (r.subCategoryId !== null || r.paymentTypeId !== null)), {
    message: "A rule that ignores a line has no sub-category or payment type",
    path: ["ignore"],
  })
  .refine(
    (r) =>
      r.minAmount === null || r.maxAmount === null || Number(r.minAmount) <= Number(r.maxAmount),
    { message: "The minimum is above the maximum", path: ["maxAmount"] },
  );
export type RuleInput = z.input<typeof ruleInputSchema>;
export type RuleFields = z.output<typeof ruleInputSchema>;

/** The new order of the rules, first to last. */
export const ruleOrderSchema = z.object({ ids: z.array(z.uuid()).min(1).max(1000) });

/** What a rule looks at in a statement line. */
export interface RuleTarget {
  accountId: string;
  currency: string;
  /** Signed, in minor units. */
  amount: bigint;
  counterparty: string;
  label: string;
  memo: string;
  bankCategory: string;
}

/** Does the line fit all the conditions of the rule? */
export function ruleMatches(rule: RuleFields, line: RuleTarget): boolean {
  if (rule.accountId !== null && rule.accountId !== line.accountId) return false;
  if (rule.direction === "in" && line.amount <= 0n) return false;
  if (rule.direction === "out" && line.amount >= 0n) return false;
  const size = line.amount < 0n ? -line.amount : line.amount;
  if (rule.minAmount !== null && size < parseAmount(rule.minAmount, line.currency).minor) {
    return false;
  }
  if (rule.maxAmount !== null && size > parseAmount(rule.maxAmount, line.currency).minor) {
    return false;
  }
  if (rule.bankCategory !== null) {
    if (!normaliseText(line.bankCategory).includes(normaliseText(rule.bankCategory))) return false;
  }
  if (rule.text !== null) {
    const haystack = normaliseText(`${line.counterparty} ${line.label} ${line.memo}`);
    if (!haystack.includes(normaliseText(rule.text))) return false;
  }
  return true;
}

/** The first rule, in the order given, that fits the line. */
export function firstRule<T extends RuleFields>(
  rules: readonly T[],
  line: RuleTarget,
): T | undefined {
  return rules.find((rule) => ruleMatches(rule, line));
}

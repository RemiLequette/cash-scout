import { z } from "zod";
import { versionSchema } from "./book.js";
import { amountTextSchema, rateSchema } from "./journal.js";

export const MONTHS = 12;

export const budgetYearSchema = z.number().int().min(2000).max(2200);

/**
 * The 12 monthly amounts of a category's grid, in the book currency, read with
 * the sign of the category's nature: spending is entered as positive numbers.
 */
export const budgetMonthsSchema = z.array(amountTextSchema).length(MONTHS);

export const categoryBudgetInputSchema = z.object({
  categoryId: z.uuid(),
  year: budgetYearSchema,
  assumptions: z.string().max(2000).optional(),
  months: budgetMonthsSchema,
  /**
   * The account the budget is expected to be spent from, where its budget lines
   * are. The API requires it as soon as a month is not zero.
   */
  accountId: z.uuid().optional(),
  /** Account currency into book currency, as for entries; required when they differ. */
  exchangeRate: rateSchema.optional(),
});

export type CategoryBudgetInput = z.infer<typeof categoryBudgetInputSchema>;

/**
 * Everything but the category and year, which identify the budget. The API
 * merges it into the stored budget and validates the result as a whole.
 */
export const categoryBudgetUpdateSchema = z.object({
  assumptions: z.string().max(2000).optional(),
  months: budgetMonthsSchema.optional(),
  accountId: z.uuid().nullable().optional(),
  exchangeRate: rateSchema.nullable().optional(),
  version: versionSchema.optional(),
});

/**
 * The budgets of a year saved in one go, which is how the preparation screen
 * works: budgets to create or replace, and categories whose budget goes away.
 * `versions` holds, per category, the version of the budget the screen read;
 * a category without one is expected to have no budget yet.
 */
export const budgetBatchSchema = z
  .object({
    year: budgetYearSchema,
    save: z.array(categoryBudgetInputSchema).max(500),
    remove: z.array(z.uuid()).max(500).optional(),
    versions: z.record(z.uuid(), versionSchema).optional(),
  })
  .superRefine((batch, ctx) => {
    if (batch.save.some((item) => item.year !== batch.year)) {
      ctx.addIssue({ code: "custom", path: ["save"], message: "Every budget is of the year" });
    }
    const categories = [...batch.save.map((item) => item.categoryId), ...(batch.remove ?? [])];
    if (new Set(categories).size !== categories.length) {
      ctx.addIssue({ code: "custom", path: ["save"], message: "A category appears once" });
    }
  });
export type BudgetBatch = z.infer<typeof budgetBatchSchema>;

export const budgetQuerySchema = z.object({
  year: z.coerce.number().pipe(budgetYearSchema),
});

/**
 * Reconciles a month's budget line, which lets the budget not used go: the line
 * goes to 0 and the month's grid amount is locked. `reconciled: false` takes
 * it back.
 */
export const settlementSchema = z.object({
  categoryId: z.uuid(),
  year: budgetYearSchema,
  month: z.number().int().min(1).max(MONTHS),
  reconciled: z.boolean(),
});
export type SettlementInput = z.infer<typeof settlementSchema>;

/**
 * What a month's grid amount still expects, given what the month's unplanned
 * entries used (both read with the nature's sign): the rest, never past zero.
 * Entries of the opposite sign, such as refunds, raise it.
 */
export function remainingBudget(budget: bigint, used: bigint): bigint {
  const left = budget - used;
  if (budget >= 0n) return left > 0n ? left : 0n;
  return left < 0n ? left : 0n;
}

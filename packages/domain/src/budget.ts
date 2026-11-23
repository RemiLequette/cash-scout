import { z } from "zod";
import { versionSchema } from "./book.js";
import { amountTextSchema, rateSchema } from "./journal.js";
import { budgetTypeSchema, namesSchema } from "./reference.js";

/** What happens to the part of a month's budget that was not used (or overspent). */
export const consumptionModes = ["lapse", "roll_over", "annual_pool"] as const;
export const consumptionModeSchema = z.enum(consumptionModes);
export type ConsumptionMode = z.infer<typeof consumptionModeSchema>;

/** Weights of a profile are in basis points: 10 000 = 100 %. */
export const WEIGHT_TOTAL = 10_000;
export const MONTHS = 12;

export const weightsSchema = z
  .array(z.number().int().min(0).max(WEIGHT_TOTAL))
  .length(MONTHS)
  .refine((weights) => weights.reduce((a, b) => a + b, 0) === WEIGHT_TOTAL, {
    message: "The 12 weights must add up to 100 %",
  });

export const profileInputSchema = z.object({
  names: namesSchema,
  weights: weightsSchema,
});
export const profileUpdateSchema = profileInputSchema
  .partial()
  .extend({ archived: z.boolean().optional(), version: versionSchema.optional() });

export const budgetYearSchema = z.number().int().min(2000).max(2200);

export const categoryBudgetInputSchema = z
  .object({
    categoryId: z.uuid(),
    year: budgetYearSchema,
    type: budgetTypeSchema,
    assumptions: z.string().max(2000).optional(),
    /** Annual amount in the book currency (periodic). */
    amount: amountTextSchema.optional(),
    profileId: z.uuid().optional(),
    consumption: consumptionModeSchema.optional(),
    /** Account where the remaining budget is expected to be spent (periodic). */
    accountId: z.uuid().optional(),
    /** Account currency into book currency, as for entries; required when they differ. */
    exchangeRate: rateSchema.optional(),
  })
  .superRefine((input, ctx) => {
    const periodicOnly = [
      "amount",
      "profileId",
      "consumption",
      "accountId",
      "exchangeRate",
    ] as const;
    if (input.type === "scheduled") {
      for (const key of periodicOnly) {
        if (input[key] !== undefined) {
          ctx.addIssue({ code: "custom", path: [key], message: "Only for a periodic budget" });
        }
      }
      return;
    }
    for (const key of ["amount", "profileId", "consumption"] as const) {
      if (input[key] === undefined) {
        ctx.addIssue({ code: "custom", path: [key], message: "Required for a periodic budget" });
      }
    }
    if (input.accountId === undefined && input.exchangeRate !== undefined) {
      ctx.addIssue({ code: "custom", path: ["exchangeRate"], message: "Needs an account" });
    }
  });

export type CategoryBudgetInput = z.infer<typeof categoryBudgetInputSchema>;

/**
 * Everything but the category and year, which identify the budget. The API
 * merges it into the stored budget and validates the result as a whole.
 */
export const categoryBudgetUpdateSchema = z.object({
  type: budgetTypeSchema.optional(),
  assumptions: z.string().max(2000).optional(),
  amount: amountTextSchema.nullable().optional(),
  profileId: z.uuid().nullable().optional(),
  consumption: consumptionModeSchema.nullable().optional(),
  accountId: z.uuid().nullable().optional(),
  exchangeRate: rateSchema.nullable().optional(),
  version: versionSchema.optional(),
});

export const budgetQuerySchema = z.object({
  year: z.coerce.number().pipe(budgetYearSchema),
});

/**
 * Spreads an annual amount over the 12 months by the profile's weights, in
 * minor units. Months 1 to 11 are rounded toward zero; the last month takes
 * the remainder, so the 12 months always add up to the annual amount.
 */
export function allocate(annual: bigint, weights: readonly number[]): bigint[] {
  if (weights.length !== MONTHS) {
    throw new RangeError(`A profile has ${MONTHS} weights`);
  }
  const months = weights.map((weight) => (annual * BigInt(weight)) / BigInt(WEIGHT_TOTAL));
  const others = months.slice(0, MONTHS - 1).reduce((a, b) => a + b, 0n);
  months[MONTHS - 1] = annual - others;
  return months;
}

export interface BudgetMonth {
  /** The month's own share of the annual amount. */
  allocated: bigint;
  /** What could be spent in the month, after the consumption mode. */
  available: bigint;
  consumed: bigint;
  /** available − consumed: negative when overspent. */
  remaining: bigint;
}

/**
 * The 12 months of a periodic budget. Consumption is positive when it uses
 * the budget (spending in an expense category).
 *
 * - lapse: each month stands alone; what is left or overspent is gone.
 * - roll_over: the remainder of a month, positive or negative, moves to the next.
 * - annual_pool: the year is one envelope; each month can use what the
 *   previous months did not.
 */
export function budgetMonths(
  allocated: readonly bigint[],
  consumed: readonly bigint[],
  mode: ConsumptionMode,
): BudgetMonth[] {
  if (allocated.length !== MONTHS || consumed.length !== MONTHS) {
    throw new RangeError(`A budget has ${MONTHS} months`);
  }
  const annual = allocated.reduce((a, b) => a + b, 0n);
  let carry = 0n;
  let used = 0n;
  return allocated.map((share, month) => {
    const spent = consumed[month]!;
    const available =
      mode === "lapse" ? share : mode === "roll_over" ? share + carry : annual - used;
    const remaining = available - spent;
    carry = remaining;
    used += spent;
    return { allocated: share, available, consumed: spent, remaining };
  });
}

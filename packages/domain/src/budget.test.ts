import { describe, expect, it } from "vitest";
import { budgetBatchSchema, categoryBudgetInputSchema, remainingBudget } from "./budget.js";

const categoryId = "6f1d3c2a-5b4e-4f6a-9c8d-1e2f3a4b5c6d";
const months = Array<string>(12).fill("0");

describe("categoryBudgetInputSchema", () => {
  it("needs 12 monthly amounts", () => {
    const budget = { categoryId, year: 2027, months };
    expect(categoryBudgetInputSchema.safeParse(budget).success).toBe(true);
    expect(
      categoryBudgetInputSchema.safeParse({ ...budget, months: months.slice(1) }).success,
    ).toBe(false);
  });

  it("takes each category once in a batch, all of the batch's year", () => {
    const budget = { categoryId, year: 2027, months };
    expect(budgetBatchSchema.safeParse({ year: 2027, save: [budget] }).success).toBe(true);
    expect(budgetBatchSchema.safeParse({ year: 2026, save: [budget] }).success).toBe(false);
    expect(budgetBatchSchema.safeParse({ year: 2027, save: [budget, budget] }).success).toBe(false);
  });
});

describe("remainingBudget", () => {
  it("is what the unplanned entries left, never past zero", () => {
    expect(remainingBudget(300n, 0n)).toBe(300n);
    expect(remainingBudget(300n, 50n)).toBe(250n);
    expect(remainingBudget(300n, 350n)).toBe(0n);
  });

  it("is raised by a refund, possibly above the budget", () => {
    expect(remainingBudget(300n, -40n)).toBe(340n);
  });

  it("works the same for a negative budget, a planned withdrawal", () => {
    expect(remainingBudget(-500n, -200n)).toBe(-300n);
    expect(remainingBudget(-500n, -600n)).toBe(0n);
  });
});

import { describe, expect, it } from "vitest";
import {
  allocate,
  budgetMonths,
  categoryBudgetInputSchema,
  profileInputSchema,
  raise,
  settlementMonths,
  weightsSchema,
} from "./budget.js";

const even = [834, 833, 833, 834, 833, 833, 834, 833, 833, 834, 833, 833];
const ids = {
  category: "6f1d3c2a-5b4e-4f6a-9c8d-1e2f3a4b5c6d",
  profile: "7a2b3c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d",
  account: "8b3c4d5e-6f7a-4b2c-9d0e-1f2a3b4c5d6e",
};
const sum = (values: readonly bigint[]) => values.reduce((a, b) => a + b, 0n);

describe("weightsSchema", () => {
  it("needs 12 weights adding up to 100 %", () => {
    expect(weightsSchema.safeParse(even).success).toBe(true);
    expect(weightsSchema.safeParse(even.slice(1)).success).toBe(false);
    expect(weightsSchema.safeParse([...even.slice(1), 0]).success).toBe(false);
    expect(weightsSchema.safeParse([...even.slice(1), -1]).success).toBe(false);
  });

  it("is used by profiles", () => {
    expect(profileInputSchema.safeParse({ names: { fr: "Régulier" }, weights: even }).success).toBe(
      true,
    );
  });
});

describe("allocate", () => {
  it("always adds up to the annual amount, the remainder going to the last month", () => {
    const months = allocate(100_001n, even);
    expect(sum(months)).toBe(100_001n);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe(8_340n); // 100001 × 8.34 % = 8340.08, rounded toward zero
    const exact = [10_000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(allocate(1_234n, exact)).toEqual([1_234n, ...Array<bigint>(11).fill(0n)]);
  });

  it("spreads by the profile: summer takes 70 % in July and August", () => {
    const summer = [300, 300, 300, 300, 300, 300, 3500, 3500, 300, 300, 300, 300];
    const months = allocate(120_000n, summer);
    expect(months[6]).toBe(42_000n);
    expect(months[7]).toBe(42_000n);
    expect(months[0]).toBe(3_600n);
    expect(sum(months)).toBe(120_000n);
  });

  it("keeps the sum for negative amounts", () => {
    expect(sum(allocate(-100_001n, even))).toBe(-100_001n);
  });

  it("refuses other than 12 weights", () => {
    expect(() => allocate(1n, [10_000])).toThrow(RangeError);
  });
});

describe("budgetMonths", () => {
  const allocated = Array<bigint>(12).fill(100n);
  const consumed = [150n, 50n, ...Array<bigint>(10).fill(0n)];

  it("lapse: a month does not carry anything", () => {
    const months = budgetMonths(allocated, consumed, "lapse");
    expect(months[0]).toMatchObject({ available: 100n, remaining: -50n });
    expect(months[1]).toMatchObject({ available: 100n, remaining: 50n });
    expect(months[2]).toMatchObject({ available: 100n, remaining: 100n });
  });

  it("roll over: the remainder, even negative, moves to the next month", () => {
    const months = budgetMonths(allocated, consumed, "roll_over");
    expect(months[0]).toMatchObject({ available: 100n, remaining: -50n });
    expect(months[1]).toMatchObject({ available: 50n, remaining: 0n });
    expect(months[2]).toMatchObject({ available: 100n, remaining: 100n });
    expect(months[3]).toMatchObject({ available: 200n, remaining: 200n });
  });

  it("annual pool: the whole year is one envelope", () => {
    const months = budgetMonths(allocated, consumed, "annual_pool");
    expect(months[0]).toMatchObject({ available: 1_200n, remaining: 1_050n });
    expect(months[1]).toMatchObject({ available: 1_050n, remaining: 1_000n });
    expect(months[11]).toMatchObject({ available: 1_000n, remaining: 1_000n });
  });

  it("needs 12 months", () => {
    expect(() => budgetMonths([1n], [1n], "lapse")).toThrow(RangeError);
  });
});

describe("categoryBudgetInputSchema", () => {
  const periodic = {
    categoryId: ids.category,
    year: 2027,
    type: "periodic",
    amount: "6000",
    profileId: ids.profile,
    consumption: "roll_over",
    accountId: ids.account,
  };

  it("accepts a periodic budget with its reference account", () => {
    expect(categoryBudgetInputSchema.safeParse(periodic).success).toBe(true);
  });

  it("needs amount, profile, consumption and account when periodic", () => {
    for (const key of ["amount", "profileId", "consumption", "accountId"]) {
      const rest: Record<string, unknown> = { ...periodic };
      delete rest[key];
      expect(categoryBudgetInputSchema.safeParse(rest).success, key).toBe(false);
    }
  });

  it("keeps the plan of a scheduled budget out of it", () => {
    const scheduled = { categoryId: ids.category, year: 2027, type: "scheduled" };
    expect(categoryBudgetInputSchema.safeParse(scheduled).success).toBe(true);
    expect(
      categoryBudgetInputSchema.safeParse({ ...scheduled, assumptions: "Rent +3 % in July" })
        .success,
    ).toBe(true);
    expect(categoryBudgetInputSchema.safeParse({ ...scheduled, amount: "100" }).success).toBe(
      false,
    );
  });

  it("needs an account for a rate", () => {
    const withoutAccount: Record<string, unknown> = { ...periodic };
    delete withoutAccount.accountId;
    expect(
      categoryBudgetInputSchema.safeParse({ ...withoutAccount, exchangeRate: "0.2" }).success,
    ).toBe(false);
  });
});

describe("raise", () => {
  it("applies a percentage in basis points, rounding half away from zero", () => {
    expect(raise(100_000n, 300)).toBe(103_000n);
    expect(raise(100_000n, -500)).toBe(95_000n);
    expect(raise(1_050n, 100)).toBe(1_061n); // 1060.5
    expect(raise(-1_050n, 100)).toBe(-1_061n);
    expect(raise(0n, 300)).toBe(0n);
  });
});

describe("settlementMonths", () => {
  it("gives a lapsing budget a line every month", () => {
    expect(settlementMonths("lapse")).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("leaves what moves on to the year's end", () => {
    expect(settlementMonths("roll_over")).toEqual([12]);
    expect(settlementMonths("annual_pool")).toEqual([12]);
  });
});

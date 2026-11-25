import { describe, expect, it } from "vitest";
import { openingFromBalance, openingInputSchema } from "./opening.js";

describe("openingFromBalance", () => {
  it("makes the reconciled entries add up to the bank balance", () => {
    const reconciled = 1_500_00n;
    const opening = openingFromBalance(21_634_75n, reconciled);
    expect(opening + reconciled).toBe(21_634_75n);
  });

  it("is negative when the entries already exceed the balance", () => {
    expect(openingFromBalance(100n, 250n)).toBe(-150n);
  });
});

describe("openingInputSchema", () => {
  it("takes an opening balance or a bank balance, not both", () => {
    expect(openingInputSchema.safeParse({ opening: "10.00" }).success).toBe(true);
    expect(openingInputSchema.safeParse({ balance: "10.00" }).success).toBe(true);
    expect(openingInputSchema.safeParse({}).success).toBe(false);
    expect(openingInputSchema.safeParse({ opening: "1", balance: "2" }).success).toBe(false);
  });

  it("accepts a day only with a bank balance", () => {
    expect(openingInputSchema.safeParse({ balance: "5", upTo: "2026-10-30" }).success).toBe(true);
    expect(openingInputSchema.safeParse({ opening: "5", upTo: "2026-10-30" }).success).toBe(false);
  });
});

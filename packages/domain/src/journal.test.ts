import { describe, expect, it } from "vitest";
import {
  bookAmount,
  entryInputSchema,
  entryUpdateSchema,
  journalQuerySchema,
  rateBetween,
  resolveRate,
  variance,
} from "./journal.js";
import { money } from "./money.js";

const ids = {
  account: "6f1d3c2a-5b4e-4f6a-9c8d-1e2f3a4b5c6d",
  sub: "7a2b3c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d",
};

const base = {
  date: "2026-11-22",
  accountId: ids.account,
  subCategoryId: ids.sub,
  amount: "-12.50",
};

describe("entryInputSchema", () => {
  it("accepts both signs: the category gives the direction, not the sign", () => {
    expect(entryInputSchema.parse(base)).toMatchObject({ amount: "-12.50", description: "" });
    expect(entryInputSchema.parse({ ...base, amount: "30" }).amount).toBe("30");
  });

  it("rejects bad dates, amounts and rates", () => {
    expect(entryInputSchema.safeParse({ ...base, date: "22/11/2026" }).success).toBe(false);
    expect(entryInputSchema.safeParse({ ...base, amount: "12,50" }).success).toBe(false);
    expect(entryInputSchema.safeParse({ ...base, exchangeRate: "0" }).success).toBe(false);
    expect(entryInputSchema.safeParse({ ...base, exchangeRate: "-1" }).success).toBe(false);
    expect(entryInputSchema.safeParse({ ...base, exchangeRate: "0.2" }).success).toBe(true);
  });

  it("needs the original amount and currency together", () => {
    expect(entryInputSchema.safeParse({ ...base, originalAmount: "10" }).success).toBe(false);
    expect(
      entryInputSchema.safeParse({ ...base, originalAmount: "10", originalCurrency: "USD" })
        .success,
    ).toBe(true);
  });
});

describe("entryUpdateSchema", () => {
  it("has no planned amount and accepts partial updates", () => {
    expect(entryUpdateSchema.parse({ amount: "-13" })).toEqual({ amount: "-13" });
    expect(entryUpdateSchema.parse({ plannedAmount: "1" } as object)).toEqual({});
    expect(
      entryUpdateSchema.safeParse({ originalAmount: null, originalCurrency: null }).success,
    ).toBe(true);
    expect(entryUpdateSchema.safeParse({ originalAmount: "1" }).success).toBe(false);
  });
});

describe("journalQuerySchema", () => {
  it("pages by default", () => {
    expect(journalQuerySchema.parse({})).toEqual({ limit: 100, offset: 0 });
    expect(journalQuerySchema.parse({ limit: "20", offset: "40" })).toEqual({
      limit: 20,
      offset: 40,
    });
    expect(journalQuerySchema.safeParse({ limit: "2000" }).success).toBe(true);
    expect(journalQuerySchema.safeParse({ limit: "2001" }).success).toBe(false);
  });

  it("reads a list of sub-categories", () => {
    const a = "0190a5c4-0000-7000-8000-000000000001";
    const b = "0190a5c4-0000-7000-8000-000000000002";
    expect(journalQuerySchema.parse({ subCategoryIds: `${a},${b}` }).subCategoryIds).toEqual([
      a,
      b,
    ]);
    expect(journalQuerySchema.parse({ subCategoryIds: "" }).subCategoryIds).toEqual([]);
    expect(journalQuerySchema.safeParse({ subCategoryIds: `${a},nope` }).success).toBe(false);
  });

  it("reads a list of months", () => {
    expect(journalQuerySchema.parse({ months: "2026-10,2026-11" }).months).toEqual([
      "2026-10",
      "2026-11",
    ]);
    expect(journalQuerySchema.parse({ months: "" }).months).toEqual([]);
    expect(journalQuerySchema.safeParse({ months: "2026-13" }).success).toBe(false);
    expect(journalQuerySchema.safeParse({ months: "2026-1" }).success).toBe(false);
  });
});

describe("rates and book amounts", () => {
  it("uses 1 in the book currency and requires a rate otherwise", () => {
    expect(resolveRate("EUR", "EUR", undefined)).toBe("1");
    expect(resolveRate("EUR", "EUR", "3")).toBe("1");
    expect(resolveRate("MYR", "EUR", "0.2")).toBe("0.2");
    expect(() => resolveRate("MYR", "EUR", undefined)).toThrow(RangeError);
  });

  it("converts to the book currency at the entry's rate", () => {
    expect(bookAmount(money(-10000n, "MYR"), "0.2", "EUR")).toEqual(money(-2000n, "EUR"));
    expect(bookAmount(money(-1250n, "EUR"), "1", "EUR")).toEqual(money(-1250n, "EUR"));
  });

  it("finds the rate between two amounts", () => {
    expect(rateBetween(money(-10000n, "MYR"), money(-2000n, "EUR"))).toBe("0.2");
    expect(rateBetween(money(1000n, "EUR"), money(1612n, "JPY"))).toBe("161.2");
    expect(rateBetween(money(300n, "MYR"), money(100n, "EUR"))).toBe("0.3333333333");
    expect(() => rateBetween(money(100n, "MYR"), money(-20n, "EUR"))).toThrow(RangeError);
  });

  it("computes the variance", () => {
    // Electricity planned at -120, debited at -138 (README example).
    expect(variance(money(-13800n, "EUR"), money(-12000n, "EUR"))).toEqual(money(-1800n, "EUR"));
  });
});

import { describe, expect, it } from "vitest";
import {
  firstRule,
  normaliseText,
  ruleInputSchema,
  ruleMatches,
  type RuleTarget,
} from "./rules.js";

let counter = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

const line: RuleTarget = {
  currency: "EUR",
  amount: -1915n,
  counterparty: "Supermarché Test",
  label: "CARTE 29/10/26 SUPERMARCHE TEST CB*0000",
  memo: "",
  bankCategory: "Alimentation",
};

const rule = (fields: Record<string, unknown>) =>
  ruleInputSchema.parse({ name: "r", subCategoryId: uuid(), ...fields });

describe("normaliseText", () => {
  it("ignores case, accents and spacing", () => {
    expect(normaliseText("  Supermarché   TEST ")).toBe("supermarche test");
  });
});

describe("ruleMatches", () => {
  it("finds the text in the counterparty, the label or the memo, ignoring accents", () => {
    expect(ruleMatches(rule({ text: "supermarche" }), line)).toBe(true);
    expect(ruleMatches(rule({ text: "CB*0000" }), line)).toBe(true);
    expect(ruleMatches(rule({ text: "boulangerie" }), line)).toBe(false);
    expect(ruleMatches(rule({ text: "paiement" }), { ...line, memo: "Paiement du mois" })).toBe(
      true,
    );
  });

  it("needs every condition", () => {
    const fits = rule({ text: "super", direction: "out", minAmount: "10", maxAmount: "20" });
    expect(ruleMatches(fits, line)).toBe(true);
    expect(ruleMatches(fits, { ...line, amount: 1915n })).toBe(false);
    expect(ruleMatches(fits, { ...line, amount: -2001n })).toBe(false);
    expect(ruleMatches(fits, { ...line, amount: -999n })).toBe(false);
    expect(ruleMatches(rule({ bankCategory: "alimentation" }), line)).toBe(true);
    expect(ruleMatches(rule({ bankCategory: "loisirs" }), line)).toBe(false);
  });

  it("reads the amounts in the line's currency", () => {
    const yen = { ...line, currency: "JPY", amount: -500n };
    expect(ruleMatches(rule({ minAmount: "500", maxAmount: "500" }), yen)).toBe(true);
  });
});

describe("firstRule", () => {
  it("takes the first that fits, in order", () => {
    const rules = [rule({ text: "boulangerie" }), rule({ text: "super" }), rule({ text: "test" })];
    expect(firstRule(rules, line)).toBe(rules[1]);
    expect(firstRule([rules[0]!], line)).toBeUndefined();
  });
});

describe("ruleInputSchema", () => {
  const sub = uuid();
  const base = { name: "r", text: "x", subCategoryId: sub };

  it("needs a condition and an action", () => {
    expect(ruleInputSchema.safeParse(base).success).toBe(true);
    expect(ruleInputSchema.safeParse({ ...base, text: "  " }).success).toBe(false);
    expect(ruleInputSchema.safeParse({ ...base, subCategoryId: null }).success).toBe(false);
    expect(
      ruleInputSchema.safeParse({ ...base, subCategoryId: null, description: "Courses" }).success,
    ).toBe(true);
    expect(ruleInputSchema.safeParse({ ...base, subCategoryId: null, ignore: true }).success).toBe(
      true,
    );
  });

  it("refuses ignoring with a sub-category, and a minimum above the maximum", () => {
    expect(ruleInputSchema.safeParse({ ...base, ignore: true }).success).toBe(false);
    expect(ruleInputSchema.safeParse({ ...base, minAmount: "5", maxAmount: "2" }).success).toBe(
      false,
    );
    expect(ruleInputSchema.safeParse({ ...base, minAmount: "-5" }).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { budgetMonth, monthKept, shiftToKeep } from "./budget-month.js";

describe("budgetMonth", () => {
  it("is the month of the date", () => {
    expect(budgetMonth("2026-10-31", false)).toBe("2026-10");
  });

  it("shifted, is the month before up to the 15th and the month after from the 16th", () => {
    expect(budgetMonth("2026-11-15", true)).toBe("2026-10");
    expect(budgetMonth("2026-11-16", true)).toBe("2026-12");
  });

  it("crosses years", () => {
    expect(budgetMonth("2026-12-31", true)).toBe("2027-01");
    expect(budgetMonth("2027-01-01", true)).toBe("2026-12");
  });
});

describe("shiftToKeep", () => {
  it("shifts a date that left its month", () => {
    expect(shiftToKeep("2026-10-31", "2026-11")).toBe(true);
    expect(shiftToKeep("2026-12-02", "2026-11")).toBe(true);
  });

  it("does not shift a date inside the month", () => {
    expect(shiftToKeep("2026-11-01", "2026-11")).toBe(false);
  });

  it("does not shift when a shift cannot reach the month", () => {
    expect(shiftToKeep("2026-10-10", "2026-11")).toBe(false);
    expect(shiftToKeep("2026-09-30", "2026-11")).toBe(false);
  });
});

describe("monthKept", () => {
  it("stays in the month meant while a shift reaches it", () => {
    expect(monthKept("2026-10-31", "2026-11")).toBe("2026-11");
    expect(monthKept("2026-11-03", "2026-11")).toBe("2026-11");
    expect(monthKept("2026-10-10", "2026-11")).toBe("2026-10");
    expect(monthKept("2026-10-31", null)).toBe("2026-10");
  });
});

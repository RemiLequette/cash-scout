import { describe, expect, it } from "vitest";
import { gridInput, pastedAmounts, spreadTotal } from "./grid.js";

const input = (old: bigint, text: string, mode?: "cell" | "operation") =>
  gridInput(old, text, 2, mode);

describe("gridInput", () => {
  it("replaces the amount with a number or a formula", () => {
    expect(input(100n, "250")).toBe(25000n);
    expect(input(100n, "1 234,56")).toBe(123456n);
    expect(input(100n, "=450*3")).toBe(135000n);
    expect(input(100n, "=(100+50)/2")).toBe(7500n);
    expect(input(100n, "")).toBe(0n);
  });

  it("changes the amount", () => {
    expect(input(30000n, "+10")).toBe(31000n);
    expect(input(30000n, "+3%")).toBe(30900n);
    expect(input(30000n, "-5 %")).toBe(28500n);
    expect(input(30000n, "*2")).toBe(60000n);
    expect(input(30000n, "/4")).toBe(7500n);
  });

  it("reads -10 as an amount in a cell, as a decrease on a selection", () => {
    expect(input(30000n, "-10")).toBe(-1000n);
    expect(input(30000n, "-10", "operation")).toBe(29000n);
    expect(input(30000n, "", "operation")).toBe(30000n);
  });

  it("refuses what means nothing", () => {
    for (const text of ["abc", "=1+", "=1/0", "+x%", "=(2"]) {
      expect(input(100n, text)).toBeNull();
    }
  });

  it("follows the decimals of the currency", () => {
    expect(gridInput(0n, "1234,6", 0)).toBe(1235n);
  });
});

describe("pastedAmounts", () => {
  it("reads the cells of a spreadsheet range", () => {
    expect(pastedAmounts("1 234,50 €\t\t-12\r\nabc\n", 2)).toEqual([123450n, 0n, -1200n, null]);
  });
});

describe("spreadTotal", () => {
  const none = Array<bigint>(12).fill(0n);

  it("spreads evenly when there is no shape, the last month taking the remainder", () => {
    const months = spreadTotal(1000n, none, none);
    expect(months.slice(0, 11)).toEqual(Array(11).fill(83n));
    expect(months[11]).toBe(87n);
  });

  it("follows a shape", () => {
    const shape = [...none];
    shape[6] = 3n;
    shape[7] = 1n;
    const months = spreadTotal(1000n, none, shape);
    expect(months[6]).toBe(750n);
    expect(months[7]).toBe(250n);
    expect(months[0]).toBe(0n);
  });

  it("leaves locked months, which count in the total", () => {
    const months = [...none];
    months[0] = 500n;
    const result = spreadTotal(1600n, months, none, new Set([0]));
    expect(result[0]).toBe(500n);
    expect(result.slice(1)).toEqual(Array(11).fill(100n));
  });
});

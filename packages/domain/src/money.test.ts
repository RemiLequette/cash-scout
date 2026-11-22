import { describe, expect, it } from "vitest";
import {
  add,
  convert,
  currencyDigits,
  formatMoney,
  money,
  parseAmount,
  sum,
  toDecimalString,
} from "./money.js";

describe("currencyDigits", () => {
  it("follows ISO 4217", () => {
    expect(currencyDigits("EUR")).toBe(2);
    expect(currencyDigits("JPY")).toBe(0);
    expect(currencyDigits("MYR")).toBe(2);
  });

  it("rejects invalid codes", () => {
    expect(() => currencyDigits("eur")).toThrow(RangeError);
  });
});

describe("parseAmount", () => {
  it("parses into minor units", () => {
    expect(parseAmount("-1234.5", "EUR")).toEqual(money(-123450n, "EUR"));
    expect(parseAmount("120", "EUR")).toEqual(money(12000n, "EUR"));
    expect(parseAmount("1500", "JPY")).toEqual(money(1500n, "JPY"));
  });

  it("rejects extra decimals and garbage", () => {
    expect(() => parseAmount("1.234", "EUR")).toThrow(RangeError);
    expect(() => parseAmount("1.5", "JPY")).toThrow(RangeError);
    expect(() => parseAmount("1,5", "EUR")).toThrow(RangeError);
  });
});

describe("toDecimalString and formatMoney", () => {
  it("round-trips exactly", () => {
    expect(toDecimalString(money(-5n, "EUR"))).toBe("-0.05");
    expect(toDecimalString(money(123450n, "EUR"))).toBe("1234.50");
    expect(toDecimalString(money(1500n, "JPY"))).toBe("1500");
  });

  it("formats per locale without float errors", () => {
    expect(formatMoney(money(123450n, "EUR"), "en-GB")).toBe("€1,234.50");
    expect(formatMoney(money(900719925474099312n, "EUR"), "en-GB")).toBe(
      "€9,007,199,254,740,993.12",
    );
  });
});

describe("add and sum", () => {
  it("adds in the same currency only", () => {
    expect(add(money(100n, "EUR"), money(-30n, "EUR"))).toEqual(money(70n, "EUR"));
    expect(() => add(money(1n, "EUR"), money(1n, "MYR"))).toThrow(RangeError);
    expect(sum([money(1n, "EUR"), money(2n, "EUR")], "EUR")).toEqual(money(3n, "EUR"));
  });
});

describe("convert", () => {
  it("converts with a decimal rate and rounds half away from zero", () => {
    // 100.00 MYR at 0.2 = 20.00 EUR
    expect(convert(money(10000n, "MYR"), "0.2", "EUR")).toEqual(money(2000n, "EUR"));
    // 0.05 EUR at 0.5 = 0.025 -> 0.03
    expect(convert(money(5n, "EUR"), "0.5", "USD")).toEqual(money(3n, "USD"));
    expect(convert(money(-5n, "EUR"), "0.5", "USD")).toEqual(money(-3n, "USD"));
    // 10.00 EUR at 161.234 = 1612.34 -> 1612 JPY
    expect(convert(money(1000n, "EUR"), "161.234", "JPY")).toEqual(money(1612n, "JPY"));
  });
});

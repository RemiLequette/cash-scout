import { describe, expect, it } from "vitest";
import {
  balanceBreaks,
  columnMappingSchema,
  previewOf,
  readStatement,
  statementDate,
} from "./statement.js";

const signed = columnMappingSchema.parse({
  date: "Date",
  amount: "Amount",
  label: "Label",
  balance: "Balance",
  dateFormat: "iso",
  decimal: ",",
  balanceDecimal: ".",
});

describe("statementDate", () => {
  it("reads the three formats", () => {
    expect(statementDate("2026-10-30", "iso")).toBe("2026-10-30");
    expect(statementDate("30/10/2026", "dmy")).toBe("2026-10-30");
    expect(statementDate("3/1/2026", "dmy")).toBe("2026-01-03");
    expect(statementDate("20260820", "yyyymmdd")).toBe("2026-08-20");
    // A spreadsheet number: 20260820.0
    expect(statementDate("20260820.0", "yyyymmdd")).toBe("2026-08-20");
  });

  it("refuses what is not a date", () => {
    expect(statementDate("31/02/2026", "dmy")).toBeUndefined();
    expect(statementDate("2026-10-30", "dmy")).toBeUndefined();
    expect(statementDate("", "iso")).toBeUndefined();
  });
});

describe("readStatement", () => {
  const table = [
    ["Date", "Label", "Amount", "Balance"],
    ["2026-10-30", " Super U ", "-18,79", "622.95"],
    ["", "", "", ""],
    ["2026-10-29", "Salaire", "1 234,50", "641.74"],
  ];

  it("reads signed amounts, balances with their own separator, and skips blank lines", () => {
    const { lines, errors } = readStatement(table, signed, "EUR");
    expect(errors).toEqual([]);
    expect(lines.map((l) => [l.row, l.date, l.label, l.amount, l.balance])).toEqual([
      [2, "2026-10-30", "Super U", -1879n, 62295n],
      [4, "2026-10-29", "Salaire", 123450n, 64174n],
    ]);
  });

  it("reads a debit and a credit column, a debit being money out whatever its sign", () => {
    const mapping = columnMappingSchema.parse({
      date: "Date",
      debit: "Debit",
      credit: "Credit",
      label: "Label",
      dateFormat: "dmy",
      decimal: ",",
    });
    const { lines, errors } = readStatement(
      [
        ["Date", "Label", "Debit", "Credit"],
        ["19/11/2026", "Virement", "", "+150,00"],
        ["13/11/2026", "Loyer", "-933,60", ""],
        ["05/11/2026", "Pret", "1076,71", ""],
      ],
      mapping,
      "EUR",
    );
    expect(errors).toEqual([]);
    expect(lines.map((l) => l.amount)).toEqual([15000n, -93360n, -107671n]);
  });

  it("finds columns by position, and joins several into one field", () => {
    const mapping = columnMappingSchema.parse({
      date: 0,
      amount: 3,
      label: [1, 2],
      dateFormat: "iso",
      decimal: ".",
    });
    const { lines } = readStatement(
      [
        ["d", "a", "b", "c"],
        ["2026-01-02", "CARD", "SHOP", "-4.50"],
      ],
      mapping,
      "EUR",
    );
    expect(lines[0]).toMatchObject({ label: "CARD SHOP", amount: -450n });
  });

  it("starts after the header line, wherever it is", () => {
    const mapping = { ...signed, headerRow: 2 };
    const { lines } = readStatement(
      [
        ["Statement of account"],
        [],
        ["Date", "Label", "Amount", "Balance"],
        ["2026-10-30", "Shop", "-1,00", "9.00"],
      ],
      mapping,
      "EUR",
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]!.row).toBe(4);
  });

  it("reports a line it cannot read and keeps the others", () => {
    const { lines, errors } = readStatement(
      [
        ["Date", "Label", "Amount", "Balance"],
        ["30/10/2026", "Shop", "-1,00", ""],
        ["2026-10-29", "Shop", "abc", ""],
        ["2026-10-28", "Shop", "-1,005", ""],
        ["2026-10-27", "Shop", "-2,00", ""],
      ],
      signed,
      "EUR",
    );
    expect(lines.map((l) => l.row)).toEqual([5]);
    expect(errors.map((e) => e.row)).toEqual([2, 3, 4]);
    expect(errors[1]!.message).toContain("abc");
  });

  it("refuses a file that lacks a mapped column", () => {
    expect(() => readStatement([["Date", "Label"]], signed, "EUR")).toThrow(RangeError);
    expect(() => readStatement([], signed, "EUR")).toThrow(RangeError);
  });
});

describe("columnMappingSchema", () => {
  const base = { date: "d", label: "l", dateFormat: "iso", decimal: "." };
  it("needs an amount, or a debit and/or a credit, not both", () => {
    expect(columnMappingSchema.safeParse(base).success).toBe(false);
    expect(columnMappingSchema.safeParse({ ...base, amount: "a" }).success).toBe(true);
    expect(columnMappingSchema.safeParse({ ...base, debit: "a", credit: "b" }).success).toBe(true);
    expect(columnMappingSchema.safeParse({ ...base, amount: "a", debit: "b" }).success).toBe(false);
  });
});

describe("balanceBreaks and previewOf", () => {
  const day = (date: string, amount: bigint, balance: bigint | null) => ({
    row: 0,
    date,
    valueDate: null,
    amount,
    label: "",
    counterparty: "",
    memo: "",
    reference: "",
    bankCategory: "",
    balance,
    accountNumber: "",
    raw: [],
  });

  it("follows the end-of-day balances, whatever the order of the lines", () => {
    const lines = [
      day("2026-10-30", -1000n, 5000n),
      day("2026-10-30", -500n, 5000n),
      day("2026-10-29", -200n, 6500n),
      day("2026-10-28", 100n, 6700n),
    ];
    expect(balanceBreaks(lines, "EUR")).toEqual([]);
  });

  it("reports the day whose balance does not follow", () => {
    const lines = [day("2026-10-30", -1000n, 5100n), day("2026-10-29", -200n, 6500n)];
    expect(balanceBreaks(lines, "EUR")).toEqual([
      { date: "2026-10-30", expected: "55.00", found: "51.00" },
    ]);
  });

  it("skips days without a balance, and gives nothing for a statement without any", () => {
    expect(balanceBreaks([day("2026-10-30", -1000n, null)], "EUR")).toEqual([]);
  });

  it("gives text amounts, the sum and the account numbers", () => {
    const lines = [
      { ...day("2026-10-30", -1050n, null), accountNumber: "123" },
      day("2026-10-29", 50n, null),
    ];
    const preview = previewOf({ lines, errors: [] }, "EUR");
    expect(preview).toMatchObject({ total: "-10.00", accountNumbers: ["123"] });
    expect(preview.lines[0]).toMatchObject({ amount: "-10.50", balance: null });
  });
});

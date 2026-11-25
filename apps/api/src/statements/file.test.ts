import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readStatementFile } from "./file.js";
import { boursorama, caisseEpargne } from "./presets.js";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../../test/fixtures/statements/${name}`, import.meta.url)));

describe("Boursorama preset", () => {
  const { lines, errors } = readStatementFile(fixture("boursorama.csv"), boursorama, "EUR");

  it("reads every line", () => {
    expect(errors).toEqual([]);
    expect(lines).toHaveLength(4);
  });

  it("takes the amount from the first Solde column and the balance from the second", () => {
    expect(lines.map((l) => [l.amount, l.balance])).toEqual([
      [-720n, 54180n],
      [-1915n, 54900n],
      [500n, 56815n],
      [-123456n, 56315n],
    ]);
  });

  it("keeps the label, the cleaned counterparty, the bank category and the account", () => {
    expect(lines[0]).toMatchObject({
      row: 2,
      date: "2026-10-30",
      valueDate: "2026-10-30",
      label: "CARTE 28/10/26 BOULANGERIE DUPONT CB*0000",
      counterparty: "Boulangerie Dupont",
      bankCategory: "Alimentation",
      accountNumber: "00000000001",
    });
  });
});

describe("Caisse d'Epargne preset", () => {
  const { lines, errors } = readStatementFile(fixture("caisse-epargne.csv"), caisseEpargne, "EUR");

  it("reads debit and credit columns into one signed amount, with no balance", () => {
    expect(errors).toEqual([]);
    expect(lines.map((l) => [l.date, l.amount, l.balance])).toEqual([
      ["2026-11-19", 15000n, null],
      ["2026-11-13", -93360n, null],
      ["2026-11-05", -107671n, null],
    ]);
  });

  it("keeps the memo, the reference and the two category levels", () => {
    expect(lines[1]).toMatchObject({
      counterparty: "AGENCE TEST",
      reference: "0000000B00000002",
      bankCategory: "A categoriser - sortie d'argent Virement emis - a categoriser",
    });
    expect(lines[2]!.reference).toBe("");
  });
});

describe("a file that is not the preset's", () => {
  it("is refused rather than misread", () => {
    expect(() => readStatementFile(fixture("caisse-epargne.csv"), boursorama, "EUR")).toThrow(
      /not in the file/,
    );
  });
});

import { afterAll, describe, expect, it } from "vitest";
import { createHarness, household } from "../../test/harness.js";
import { withUser } from "../db/client.js";
import { journalEntry } from "../db/schema.js";
import { decimalText, importJournal, isoDate } from "./journal.js";
import { ImportError, importReference } from "./reference.js";

const h = createHarness();
afterAll(() => h.sql.end());

const categories = [
  "group;category;code;nature;sub_category",
  "Vie courante;Alimentation;C01;Dépenses;Boulangerie",
  "Vie courante;Alimentation;C01;Dépenses;Divers",
  "Loisirs;Sorties;C02;Dépenses;Divers",
  "Revenus;Salaires;R01;Revenus;Paie",
].join("\n");
const accounts = ["name;currency", "Compte courant;EUR", "Compte MYR;MYR"].join("\n");

async function bookOf() {
  const owner = await h.signedInUser();
  const created = await owner.request("POST", "/books", household);
  const { id: bookId } = (await created.json()) as { id: string };
  await withUser(h.db, owner.id, (tx) =>
    importReference(tx, bookId, { categories, accounts, paymentTypes: "name\nCarte\n" }),
  );
  const run = (csv: string) => withUser(h.db, owner.id, (tx) => importJournal(tx, bookId, csv));
  const entries = () =>
    withUser(h.db, owner.id, (tx) => tx.select().from(journalEntry).orderBy(journalEntry.date));
  return { owner, bookId, run, entries };
}

describe("value parsing", () => {
  it("reads French and ISO formats", () => {
    expect(decimalText("-1 234,56")).toBe("-1234.56");
    expect(decimalText("1,234.56")).toBe("1234.56");
    expect(decimalText("12")).toBe("12");
    expect(decimalText(`2${String.fromCharCode(0x202f)}000,5`)).toBe("2000.5");
    expect(isoDate("2026-11-22")).toBe("2026-11-22");
    expect(isoDate("2/3/2026")).toBe("2026-03-02");
    expect(isoDate("31/02/2026")).toBeUndefined();
    expect(isoDate("2026/11/22")).toBeUndefined();
  });
});

describe("importJournal", () => {
  it("matches reference data by name and fills the amounts", async () => {
    const b = await bookOf();
    const csv = [
      "date;account;sub_category;category_code;description;payment_type;amount;planned_amount;reconciled",
      "02/11/2026;compte courant;Boulangerie;;Pain;carte;-3,20;;oui",
      "2026-11-25;Compte courant;Paie;;Salaire;;2 000,00;1900;non",
      "2026-11-03;Compte courant;Divers;C02;Cinéma;;-12;;",
    ].join("\n");
    expect(await b.run(csv)).toEqual({ created: 3 });

    const rows = await b.entries();
    expect(
      rows.map((r) => [r.date, r.amount, r.plannedAmount, r.bookAmount, r.reconciled]),
    ).toEqual([
      ["2026-11-02", -320n, -320n, -320n, true],
      ["2026-11-03", -1200n, -1200n, -1200n, false],
      ["2026-11-25", 200000n, 190000n, 200000n, false],
    ]);
    expect(rows[0]!.paymentTypeId).not.toBeNull();
  });

  it("takes a rate or a book amount for other currencies", async () => {
    const b = await bookOf();
    const csv = [
      "date,account,sub_category,amount,exchange_rate,book_amount,original_amount,original_currency",
      "2026-11-02,Compte MYR,Boulangerie,-100,0.2,,,",
      "2026-11-03,Compte MYR,Boulangerie,-30,,-6.00,-6.40,usd",
    ].join("\n");
    await b.run(csv);
    const rows = await b.entries();
    expect(
      rows.map((r) => [r.exchangeRate, r.bookAmount, r.originalAmount, r.originalCurrency]),
    ).toEqual([
      ["0.2", -2000n, null, null],
      ["0.2", -600n, -640n, "USD"],
    ]);
  });

  it("names the wrong line and imports nothing", async () => {
    const b = await bookOf();
    const header = "date;account;sub_category;amount";
    const cases: [string, RegExp][] = [
      ["2026-11-02;Compte courant;Divers;-1", /Line 2: "Divers" names more than one sub-category/],
      ["2026-11-02;Livret;Boulangerie;-1", /Line 2: no account named "Livret"/],
      ["2026-13-02;Compte courant;Boulangerie;-1", /Line 2: invalid date/],
      ["2026-11-02;Compte courant;Boulangerie;-1.234", /Line 2: amount/],
      ["2026-11-02;Compte MYR;Boulangerie;-1", /Line 2: the account is in MYR/],
    ];
    for (const [line, message] of cases) {
      const attempt = b.run(`${header}\n2026-11-01;Compte courant;Boulangerie;-1\n${line}`);
      await expect(attempt).rejects.toThrow(ImportError);
      await expect(b.run(`${header}\n${line}`).catch((e: Error) => e.message)).resolves.toMatch(
        message,
      );
    }
    expect(await b.entries()).toEqual([]);
  });
});

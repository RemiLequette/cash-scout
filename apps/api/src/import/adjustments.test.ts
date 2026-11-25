import { afterAll, describe, expect, it } from "vitest";
import { createHarness, household } from "../../test/harness.js";
import { withUser } from "../db/client.js";
import { bookAccount, journalEntry, subCategory } from "../db/schema.js";
import { convertAdjustments } from "./adjustments.js";
import { importJournal } from "./journal.js";
import { ImportError, importReference } from "./reference.js";

const h = createHarness();
afterAll(() => h.sql.end());

const categories = [
  "group;category;code;nature;sub_category",
  "Vie courante;Alimentation;C01;Dépenses;Boulangerie",
  "Divers;Ajustements;Z01;Dépenses;Ajustement",
].join("\n");
const accounts = ["name;currency", "Compte courant;EUR", "Compte MYR;MYR"].join("\n");
const journal = [
  "date;account;sub_category;amount;exchange_rate;reconciled",
  "2026-01-05;Compte courant;Ajustement;1000;;oui",
  "2026-02-03;Compte courant;Boulangerie;-12,50;;oui",
  "2026-03-10;Compte courant;Ajustement;-40;;oui",
  "2026-02-04;Compte MYR;Ajustement;500;0,2;oui",
  "2026-02-10;Compte MYR;Boulangerie;-50;0,2;oui",
].join("\n");

async function book() {
  const owner = await h.signedInUser();
  const created = await owner.request("POST", "/books", household);
  const { id: bookId } = (await created.json()) as { id: string };
  await withUser(h.db, owner.id, async (tx) => {
    await importReference(tx, bookId, { categories, accounts, paymentTypes: "name\nCarte\n" });
    await importJournal(tx, bookId, journal);
  });
  const balances = async () => {
    const res = await owner.request("GET", `/books/${bookId}/journal/balances`);
    const rows = (await res.json()) as { accountId: string; reconciled: string; total: string }[];
    return rows.map((r) => [r.reconciled, r.total]).sort();
  };
  const run = (name: string, apply: boolean) =>
    withUser(h.db, owner.id, (tx) => convertAdjustments(tx, bookId, name, apply));
  return { owner, bookId, balances, run };
}

describe("convertAdjustments", () => {
  it("reports without changing anything", async () => {
    const b = await book();
    const before = await b.balances();
    const report = await b.run("ajustement", false);
    expect(report.subCategories).toEqual([
      { id: expect.any(String), name: "Ajustement", category: "Ajustements" },
    ]);
    expect(report.accounts).toEqual([
      expect.objectContaining({
        name: "Compte courant",
        entries: 2,
        total: "960.00",
        months: ["2026-01", "2026-03"],
      }),
      expect.objectContaining({ name: "Compte MYR", entries: 1, total: "500.00" }),
    ]);
    expect(report.emptiedCategories).toEqual(["Ajustements"]);
    expect(await b.balances()).toEqual(before);
    const kept = await withUser(h.db, b.owner.id, (tx) => tx.select().from(journalEntry));
    expect(kept).toHaveLength(5);
  });

  it("moves the adjustments into the opening balances and keeps every balance", async () => {
    const b = await book();
    const before = await b.balances();
    await b.run("Ajustement", true);

    expect(await b.balances()).toEqual(before);
    const rows = await withUser(h.db, b.owner.id, async (tx) => ({
      entries: await tx.select().from(journalEntry),
      subs: await tx.select().from(subCategory),
      accounts: await tx.select().from(bookAccount),
    }));
    expect(rows.entries).toHaveLength(2);
    expect(rows.subs.map((s) => s.names.fr)).toEqual(["Boulangerie"]);
    const opening = Object.fromEntries(
      rows.accounts.map((a) => [a.names.fr, [a.openingBalance, a.openingBookAmount]]),
    );
    // 1000 − 40 euros; 500 ringgit at 0.2, which is 100 euros.
    expect(opening["Compte courant"]).toEqual([96000n, 96000n]);
    expect(opening["Compte MYR"]).toEqual([50000n, 10000n]);
  });

  it("refuses a name that no sub-category has", async () => {
    const b = await book();
    await expect(b.run("Inconnu", true)).rejects.toThrow(ImportError);
  });
});

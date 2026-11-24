import { afterAll, describe, expect, it } from "vitest";
import { createHarness, household } from "../../test/harness.js";
import { withUser } from "../db/client.js";
import { ImportError, importReference, parseCsv } from "./reference.js";

const h = createHarness();
afterAll(() => h.sql.end());

async function bookOf() {
  const owner = await h.signedInUser();
  const created = await owner.request("POST", "/books", household);
  const { id } = (await created.json()) as { id: string };
  await owner.request("PATCH", `/books/${id}`, {
    name: household.name,
    defaultLanguage: "fr",
    languages: ["fr", "en"],
  });
  return { owner, bookId: id };
}

const categories = [
  "group;group@en;category;category@en;code;nature;sub_category;sub_category@en",
  "Vie courante;Daily life;Alimentation;Food;C01;Dépenses;Boulangerie;Bakery",
  "Vie courante;Daily life;Alimentation;Food;C01;Dépenses;Supermarché;",
  "Revenus;Income;Salaires;Salaries;R01;Revenus;;",
].join("\n");

const accounts = [
  "name,name@en,kind,currency,low_balance_threshold",
  "Compte courant,Current account,bank,EUR,-200",
  "Compensations,,virtual,EUR,",
].join("\n");

describe("parseCsv", () => {
  it("detects the delimiter and lower-cases the header", () => {
    expect(parseCsv("Name;Kind\nA;bank\n")).toEqual([{ name: "A", kind: "bank" }]);
    expect(parseCsv('\uFEFFname,kind\n"A, B",bank\n')).toEqual([{ name: "A, B", kind: "bank" }]);
  });
});

describe("importReference", () => {
  it("creates the tree, accounts and payment types, and can be re-run", async () => {
    const { owner, bookId } = await bookOf();
    const csv = { categories, accounts, paymentTypes: "name\nCarte\nChèque\n" };

    const first = await withUser(h.db, owner.id, (tx) => importReference(tx, bookId, csv));
    expect(first.created).toEqual({
      groups: 2,
      categories: 2,
      subCategories: 2,
      accounts: 2,
      paymentTypes: 2,
    });

    const again = await withUser(h.db, owner.id, (tx) => importReference(tx, bookId, csv));
    expect(again.created).toEqual({
      groups: 0,
      categories: 0,
      subCategories: 0,
      accounts: 0,
      paymentTypes: 0,
    });
    expect(again.existing).toBe(6);

    const reference = (await (await owner.request("GET", `/books/${bookId}/reference`)).json()) as {
      natures: { id: string; names: Record<string, string> }[];
      categories: { code: string; natureId: string; names: object }[];
      accounts: { kind: string; lowBalanceThreshold: string | null }[];
    };
    const nature = (name: string) => reference.natures.find((n) => n.names.fr === name)!.id;
    expect(reference.categories).toEqual([
      expect.objectContaining({
        code: "C01",
        natureId: nature("Dépenses"),
        names: { fr: "Alimentation", en: "Food" },
      }),
      expect.objectContaining({ code: "R01", natureId: nature("Revenus") }),
    ]);
    expect(reference.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "bank", lowBalanceThreshold: "-200.00" }),
        expect.objectContaining({ kind: "virtual", lowBalanceThreshold: null }),
      ]),
    );
  });

  it("reports the line of an error and imports nothing", async () => {
    const { owner, bookId } = await bookOf();
    const bad = categories + "\nAutres;;Divers;;D01;sideways;;";
    await expect(
      withUser(h.db, owner.id, (tx) => importReference(tx, bookId, { categories: bad })),
    ).rejects.toThrow(new ImportError('Line 5: the book has no nature named "sideways"'));

    const reference = (await (await owner.request("GET", `/books/${bookId}/reference`)).json()) as {
      groups: unknown[];
    };
    expect(reference.groups).toEqual([]);
  });

  it("refuses languages the book does not use", async () => {
    const { owner, bookId } = await bookOf();
    await expect(
      withUser(h.db, owner.id, (tx) =>
        importReference(tx, bookId, { paymentTypes: "name,name@de\nCarte,Karte\n" }),
      ),
    ).rejects.toThrow(/Line 2: Languages not in the book: de/);
  });

  it("cannot write into another user's book", async () => {
    const { bookId } = await bookOf();
    const stranger = await h.signedInUser();
    await expect(
      withUser(h.db, stranger.id, (tx) =>
        importReference(tx, bookId, { paymentTypes: "name\nCarte\n" }),
      ),
    ).rejects.toThrow();
  });
});

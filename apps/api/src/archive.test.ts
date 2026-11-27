import { readFileSync } from "node:fs";
import { getTableColumns, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { afterAll, describe, expect, it } from "vitest";
import { createHarness, defaultNature, household } from "../test/harness.js";
import type { BookArchive } from "./archive/export.js";
import { APART, ARCHIVED, OMITTED, tableName } from "./archive/tables.js";
import * as schema from "./db/schema.js";

const h = createHarness();
afterAll(() => h.sql.end());

const statement = new Uint8Array(
  readFileSync(new URL("../test/fixtures/statements/boursorama.csv", import.meta.url)),
);

type User = Awaited<ReturnType<typeof h.signedInUser>>;

async function json<T>(response: Response | Promise<Response>, status = 200): Promise<T> {
  const res = await response;
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}

/** A book with a journal, a transfer, a budget, a rule and an imported statement. */
async function filledBook() {
  const owner = await h.signedInUser();
  const { id: bookId } = await json<{ id: string }>(
    owner.request("POST", "/books", household),
    201,
  );
  const at = (path: string) => `/books/${bookId}${path}`;
  const create = async (path: string, body: object | Uint8Array) =>
    (await json<{ id: string }>(owner.request("POST", at(path), body), 201)).id;

  const parent = await create("/reference/groups", { names: { fr: "Tout" } });
  const group = await create("/reference/groups", { names: { fr: "Courant" }, parentId: parent });
  const expense = await defaultNature(owner, bookId, "expense");
  const category = await create("/reference/categories", {
    groupId: group,
    code: "C01",
    natureId: expense,
    names: { fr: "Alimentation" },
  });
  const sub = await create("/reference/sub-categories", {
    categoryId: category,
    names: { fr: "Pain" },
  });
  const transferCategory = await create("/reference/categories", {
    groupId: group,
    code: "T01",
    natureId: await defaultNature(owner, bookId, "transfer"),
    names: { fr: "Virements" },
  });
  const transferSub = await create("/reference/sub-categories", {
    categoryId: transferCategory,
    names: { fr: "Virement" },
  });
  await create("/reference/balances", { names: { fr: "Courant" }, natureIds: [expense] });
  const paymentType = await create("/reference/payment-types", { names: { fr: "Carte" } });
  const account = (name: string) =>
    create("/reference/accounts", { names: { fr: name }, kind: "bank", currency: "EUR" });
  const current = await account("Courant");
  const savings = await account("Épargne");

  await create("/journal", {
    date: "2026-11-03",
    accountId: current,
    subCategoryId: sub,
    paymentTypeId: paymentType,
    description: "Boulangerie",
    amount: "-12.50",
  });
  await create("/transfers", {
    date: "2026-11-04",
    delayDays: 2,
    sourceAccountId: current,
    destinationAccountId: savings,
    subCategoryId: transferSub,
    amount: "100",
  });
  await create("/budgets", {
    categoryId: category,
    year: 2026,
    months: Array<string>(12).fill("200"),
    accountId: current,
  });
  await create("/statements/rules", { name: "Tout", direction: "out", subCategoryId: sub });
  const batch = await create(
    `/statements/batches?preset=boursorama&account=${current}&name=a.csv`,
    statement,
  );
  const { lines } = await json<{ lines: { id: string; amount: string }[] }>(
    owner.request("GET", at(`/statements/batches/${batch}`)),
  );
  const line = lines.find((l) => l.amount === "-7.20")!;
  await owner.request("PATCH", at(`/statements/batches/${batch}/lines`), {
    changes: [{ id: line.id, subCategoryId: sub }],
  });
  expect(
    await json(owner.request("POST", at(`/statements/batches/${batch}/import`), {})),
  ).toMatchObject({ created: expect.any(Number) });
  return { owner, bookId, at };
}

const exportOf = (owner: User, bookId: string) =>
  json<BookArchive>(owner.request("GET", `/books/${bookId}/export`));

const importFile = (owner: User, content: unknown, query = "") =>
  owner.request("POST", `/books/import${query}`, new TextEncoder().encode(JSON.stringify(content)));

/** The file with every identifier replaced by what the row it names holds. */
function withoutIds(archive: BookArchive) {
  const seen = new Map<string, string>();
  const tables: Record<string, string[]> = {};
  for (const { table } of ARCHIVED) {
    // Parent groups first, so a group can be described by its parent.
    const rows = [...archive.tables[tableName(table)]!].sort(
      (a, b) => Number(a.parentId != null) - Number(b.parentId != null),
    );
    tables[tableName(table)] = rows
      .map(({ id, ...row }) => {
        const text = JSON.stringify(row, (_, value: unknown) =>
          typeof value === "string" ? (seen.get(value) ?? value) : value,
        );
        if (typeof id === "string") seen.set(id, text);
        return text;
      })
      .sort();
  }
  return { languages: archive.languages, tables };
}

describe("book export and import", () => {
  it("covers every table of a book and every reference between them", () => {
    const tables = Object.values(schema).filter((value) => is(value, PgTable)) as PgTable[];
    const ofBooks = tables.filter((table) => "bookId" in getTableColumns(table));
    const known = [...ARCHIVED.map((a) => a.table), ...APART];
    expect(ofBooks.filter((table) => !known.includes(table)).map(tableName)).toEqual([]);

    for (const { table, references } of ARCHIVED) {
      const ids = Object.entries(getTableColumns(table))
        .filter(([key, column]) => column.getSQLType() === "uuid" && key !== "id")
        .map(([key]) => key)
        .filter((key) => !OMITTED.has(key));
      expect(Object.keys(references).sort(), tableName(table)).toEqual(ids.sort());
    }
  });

  it("copies a whole book into a new one", async () => {
    const { owner, bookId, at } = await filledBook();
    const first = await exportOf(owner, bookId);
    for (const name of [
      "journal_entry",
      "transfer",
      "category_budget",
      "balance_nature",
      "import_rule",
      "import_batch",
      "import_line",
    ]) {
      expect(first.tables[name]!.length, name).toBeGreaterThan(0);
    }

    const { id } = await json<{ id: string }>(importFile(owner, first, "?name=Copie"), 201);
    expect(id).not.toBe(bookId);
    const second = await exportOf(owner, id);
    expect(second.book).toEqual({ ...first.book, name: "Copie" });
    expect(withoutIds(second)).toEqual(withoutIds(first));
    // The imported lines still know their entries, so the import can be undone.
    expect(second.tables.import_line!.filter((l) => l.entryId).length).toBeGreaterThan(0);

    // The same balances, whatever the order the accounts come in.
    const balances = async (path: string) => {
      const read = await json<{ currency: string; reconciled: string; total: string }[]>(
        owner.request("GET", path),
      );
      return read.map((a) => `${a.currency} ${a.reconciled} ${a.total}`).sort();
    };
    expect(await balances(`/books/${id}/journal/balances`)).toEqual(
      await balances(at("/journal/balances")),
    );
  });

  it("is for owners to export", async () => {
    const { owner, at } = await filledBook();
    const editor = await h.signedInUser();
    await owner.request("POST", at("/members"), { email: editor.email, role: "editor" });
    expect((await editor.request("GET", at("/export"))).status).toBe(403);
    const stranger = await h.signedInUser();
    expect((await stranger.request("GET", at("/export"))).status).toBe(404);
  });

  it("refuses what it cannot copy faithfully, and writes nothing", async () => {
    const { owner, bookId } = await filledBook();
    const archive = await exportOf(owner, bookId);
    const books = async () => (await json<unknown[]>(owner.request("GET", "/books"))).length;
    const before = await books();

    const entry = archive.tables.journal_entry![0]!;
    const withEntry = (change: object) => ({
      ...archive,
      tables: { ...archive.tables, journal_entry: [{ ...entry, ...change }], import_line: [] },
    });
    for (const content of [
      { hello: "world" },
      { ...archive, version: 99 },
      { ...archive, tables: { ...archive.tables, other: [] } },
      withEntry({ amount: 12 }),
      withEntry({ extra: 1 }),
      // A reference to a row that is not in the file, as one of another book would be.
      withEntry({ accountId: crypto.randomUUID() }),
      // Refused by the database, once the book and its reference data are written.
      withEntry({ exchangeRate: "0" }),
    ]) {
      expect((await importFile(owner, content)).status).toBe(400);
    }
    expect(await books()).toBe(before);
  });
});

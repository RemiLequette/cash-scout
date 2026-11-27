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
  const account = (name: string) =>
    create("/reference/accounts", { names: { fr: name }, currency: "EUR" });
  const current = await account("Courant");
  const savings = await account("Épargne");

  await create("/journal", {
    date: "2026-11-03",
    accountId: current,
    subCategoryId: sub,
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

  it("reads a file that still holds payment types, and leaves them out", async () => {
    const { owner, bookId } = await filledBook();
    const archive = await exportOf(owner, bookId);
    const paid = crypto.randomUUID();
    const onlyPaid = crypto.randomUUID();
    const [rule] = archive.tables.import_rule!;
    const lines = archive.tables.import_line!;
    // As a file of before: its own table, a value on the rows, and a rule that only gave one.
    const old = {
      ...archive,
      tables: {
        ...archive.tables,
        payment_type: [{ id: paid, names: { fr: "Carte" }, archivedAt: null }],
        journal_entry: archive.tables.journal_entry!.map((e) => ({ ...e, paymentTypeId: paid })),
        import_rule: [
          { ...rule, paymentTypeId: paid },
          {
            ...rule,
            id: onlyPaid,
            position: 2,
            subCategoryId: null,
            description: null,
            paymentTypeId: paid,
          },
        ],
        import_line: lines.map((l, index) => ({
          ...l,
          paymentTypeId: index === 0 ? paid : null,
          ruleId: index === 0 ? onlyPaid : l.ruleId,
        })),
      },
    };

    const { id } = await json<{ id: string }>(importFile(owner, old, "?name=Ancien"), 201);
    const copy = await exportOf(owner, id);
    expect(Object.keys(copy.tables)).not.toContain("payment_type");
    expect(copy.tables.journal_entry).toHaveLength(archive.tables.journal_entry!.length);
    expect(copy.tables.import_rule!.map((r) => r.name)).toEqual([rule!.name]);
    expect(copy.tables.import_line).toHaveLength(lines.length);
    // The line of the rule that went follows no rule.
    expect(copy.tables.import_line!.filter((l) => l.ruleId).length).toBe(
      lines.slice(1).filter((l) => l.ruleId).length,
    );
  });

  it("reads a file with account kinds, leaving an unused virtual account out", async () => {
    const { owner, bookId } = await filledBook();
    const archive = await exportOf(owner, bookId);
    const accounts = archive.tables.book_account!;
    const virtual = { ...accounts[0], id: crypto.randomUUID(), openingBalance: "0" };
    const old = (extra: Record<string, unknown[]> = {}) => ({
      ...archive,
      tables: {
        ...archive.tables,
        book_account: [
          ...accounts.map((a) => ({ ...a, kind: "bank" })),
          { ...virtual, kind: "virtual" },
        ],
        ...extra,
      },
    });

    const { id } = await json<{ id: string }>(importFile(owner, old()), 201);
    expect((await exportOf(owner, id)).tables.book_account).toHaveLength(accounts.length);

    const [entry] = archive.tables.journal_entry!;
    const used = old({ journal_entry: [{ ...entry, accountId: virtual.id }] });
    const refused = await importFile(owner, used);
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain("virtual account in use");
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

import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { createHarness, defaultNature, household } from "../test/harness.js";

const h = createHarness();
afterAll(() => h.sql.end());

// Four lines: -7.20 and -19.15 on 10-30, +5.00 on 10-28, -1234.56 on 10-27;
// the balance at the end of 10-30 is 541.80.
const statement = new Uint8Array(
  readFileSync(new URL("../test/fixtures/statements/boursorama.csv", import.meta.url)),
);

interface Entry {
  id: string;
  date: string;
  amount: string;
  reconciled: boolean;
  description: string;
}
interface Line {
  id: string;
  date: string;
  amount: string;
  status: string;
  entry: { id: string } | null;
  candidates: { id: string }[];
  duplicate: boolean;
}
interface Batch {
  lines: Line[];
  forecasts: { id: string }[];
  unmatched: { id: string }[];
  opening: { current: string; proposed: string; suggested: boolean } | null;
}

async function setup() {
  const owner = await h.signedInUser();
  const created = async (path: string, body: unknown) => {
    const res = await owner.request("POST", path, body);
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };
  const bookId = await created("/books", household);
  const ref = `/books/${bookId}/reference`;
  const accountId = await created(`${ref}/accounts`, {
    names: { fr: "Compte" },
    kind: "bank",
    currency: "EUR",
  });
  const groupId = await created(`${ref}/groups`, { names: { fr: "Vie" } });
  const categoryId = await created(`${ref}/categories`, {
    code: "1",
    names: { fr: "Courses" },
    groupId,
    natureId: await defaultNature(owner, bookId, "expense"),
  });
  const subCategoryId = await created(`${ref}/sub-categories`, {
    categoryId,
    names: { fr: "Courses" },
  });
  const journal = `/books/${bookId}/journal`;
  const addEntry = (date: string, amount: string, reconciled = false) =>
    created(journal, { date, accountId, subCategoryId, amount, reconciled, description: "saisie" });
  const entries = async () =>
    ((await (await owner.request("GET", journal)).json()) as { entries: Entry[] }).entries;
  const batches = `/books/${bookId}/statements/batches`;
  const keep = () =>
    created(`${batches}?preset=boursorama&account=${accountId}&name=a.csv`, statement);
  const read = async (id: string) =>
    (await (await owner.request("GET", `${batches}/${id}`)).json()) as Batch;
  const change = (id: string, changes: unknown[]) =>
    owner.request("PATCH", `${batches}/${id}/lines`, { changes });
  const run = (id: string, body: unknown = {}) =>
    owner.request("POST", `${batches}/${id}/import`, body);
  const undo = (id: string) => owner.request("POST", `${batches}/${id}/undo`, {});
  const opening = async () => {
    const res = await owner.request("GET", ref);
    const { accounts } = (await res.json()) as { accounts: { openingBalance: string }[] };
    return accounts[0]!.openingBalance;
  };
  return {
    owner,
    bookId,
    accountId,
    subCategoryId,
    batches,
    addEntry,
    entries,
    keep,
    read,
    change,
    run,
    undo,
    opening,
  };
}

describe("statement review and import", () => {
  it("proposes the entry a line may be, and reconciles it at the bank's date", async () => {
    const b = await setup();
    const forecast = await b.addEntry("2026-11-02", "-19.15");
    const id = await b.keep();
    const batch = await b.read(id);
    const line = batch.lines.find((l) => l.amount === "-19.15")!;
    expect(line.candidates.map((c) => c.id)).toEqual([forecast]);
    expect(batch.lines.filter((l) => l.candidates.length > 0)).toHaveLength(1);

    expect((await b.change(id, [{ id: line.id, entryId: forecast }])).status).toBe(204);
    const res = await b.run(id);
    expect(await res.json()).toEqual({ created: 0, matched: 1, openingSet: false });
    expect(await b.entries()).toEqual([
      expect.objectContaining({ id: forecast, date: "2026-10-30", reconciled: true }),
    ]);
    expect((await b.read(id)).lines.find((l) => l.id === line.id)).toMatchObject({
      status: "imported",
      entry: { id: forecast },
    });
    // Nothing is left to import, and an imported line no longer changes.
    expect((await b.run(id)).status).toBe(400);
    expect((await b.change(id, [{ id: line.id, status: "ignored" }])).status).toBe(400);
  });

  it("creates reconciled entries and sets the opening balance from the statement", async () => {
    const b = await setup();
    const id = await b.keep();
    const lines = (await b.read(id)).lines;
    const changes = lines.map((l) =>
      l.amount === "5.00"
        ? { id: l.id, status: "ignored" }
        : { id: l.id, subCategoryId: b.subCategoryId },
    );
    // No opening balance while a line is still to review.
    await b.change(id, changes.slice(0, 2));
    expect((await b.read(id)).opening).toBeNull();
    expect((await b.run(id, { setOpening: true })).status).toBe(400);
    expect(await b.entries()).toEqual([]);

    await b.change(id, changes.slice(2));
    // 541.80 − (−7.20 − 19.15 − 1234.56): the ignored line is not in the journal.
    expect((await b.read(id)).opening).toEqual(
      expect.objectContaining({ current: "0.00", proposed: "1802.71", suggested: true }),
    );
    const res = await b.run(id, { setOpening: true });
    expect(await res.json()).toEqual({ created: 3, matched: 0, openingSet: true });
    const entries = await b.entries();
    expect(entries).toHaveLength(3);
    expect(entries.every((e) => e.reconciled && e.description !== "")).toBe(true);
    expect(await b.opening()).toBe("1802.71");
  });

  it("counts a matched forecast in the opening balance, once", async () => {
    const b = await setup();
    await b.addEntry("2026-10-01", "100.00", true);
    const forecast = await b.addEntry("2026-11-03", "-19.15");
    const id = await b.keep();
    const lines = (await b.read(id)).lines;
    await b.change(
      id,
      lines.map((l) =>
        l.amount === "-19.15" ? { id: l.id, entryId: forecast } : { id: l.id, status: "ignored" },
      ),
    );
    const { opening } = await b.read(id);
    // 541.80 − (100.00 − 19.15)
    expect(opening).toMatchObject({ proposed: "460.95", suggested: false });
    await b.run(id, { setOpening: true });
    expect(await b.opening()).toBe("460.95");
    expect((await b.read(id)).opening).toMatchObject({ current: "460.95", proposed: "460.95" });
  });

  it("does not propose or accept an entry another line already is", async () => {
    const b = await setup();
    const entry = await b.addEntry("2026-10-30", "-7.20", true);
    const first = await b.keep();
    const line = (await b.read(first)).lines.find((l) => l.amount === "-7.20")!;
    await b.change(first, [{ id: line.id, entryId: entry }]);

    const second = await b.keep();
    const again = (await b.read(second)).lines.find((l) => l.amount === "-7.20")!;
    expect(again).toMatchObject({ duplicate: true, candidates: [] });
    expect((await b.change(second, [{ id: again.id, entryId: entry }])).status).toBe(400);
  });

  it("refuses a reconciled entry of another amount, and writes nothing when one change is wrong", async () => {
    const b = await setup();
    const entry = await b.addEntry("2026-10-30", "-8.00", true);
    const id = await b.keep();
    const [first, second] = (await b.read(id)).lines;
    const res = await b.change(id, [
      { id: first!.id, subCategoryId: b.subCategoryId },
      { id: second!.id, entryId: entry },
    ]);
    expect(res.status).toBe(400);
    expect((await b.read(id)).lines.map((l) => l.status)).toEqual([
      "review",
      "review",
      "review",
      "review",
    ]);
  });

  it("undoes an import: created entries go, reconciled ones come back", async () => {
    const b = await setup();
    const forecast = await b.addEntry("2026-11-02", "-19.15");
    const id = await b.keep();
    const lines = (await b.read(id)).lines;
    await b.change(
      id,
      lines.map((l) =>
        l.amount === "-19.15"
          ? { id: l.id, entryId: forecast }
          : l.amount === "-7.20"
            ? { id: l.id, subCategoryId: b.subCategoryId }
            : { id: l.id, status: "ignored" },
      ),
    );
    await b.run(id);
    expect(await b.entries()).toHaveLength(2);

    const res = await b.undo(id);
    expect(await res.json()).toEqual({ removed: 1, restored: 1, skipped: 0 });
    expect(await b.entries()).toEqual([
      expect.objectContaining({ id: forecast, date: "2026-11-02", reconciled: false }),
    ]);
    const after = (await b.read(id)).lines;
    expect(after.filter((l) => l.status === "validated")).toHaveLength(2);
    // The line is still the forecast it was matched to; the created one is open again.
    expect(after.find((l) => l.amount === "-19.15")!.entry).toMatchObject({ id: forecast });
    expect(after.find((l) => l.amount === "-7.20")!.entry).toBeNull();
    // Nothing is left to undo, and the batch can be imported again.
    expect((await b.undo(id)).status).toBe(400);
    expect(await (await b.run(id)).json()).toMatchObject({ created: 1, matched: 1 });
  });

  it("leaves an entry the user deleted since, when undoing", async () => {
    const b = await setup();
    const id = await b.keep();
    const line = (await b.read(id)).lines[0]!;
    await b.change(id, [{ id: line.id, subCategoryId: b.subCategoryId }]);
    await b.run(id);
    const [entry] = await b.entries();
    await b.owner.request("DELETE", `/books/${b.bookId}/journal/${entry!.id}`);
    expect(await (await b.undo(id)).json()).toEqual({ removed: 0, restored: 0, skipped: 1 });
  });

  it("gives a forecast of another amount the bank's, and gives it back on undo", async () => {
    const b = await setup();
    const forecast = await b.addEntry("2026-11-05", "-18.00");
    const id = await b.keep();
    const line = (await b.read(id)).lines.find((l) => l.amount === "-19.15")!;
    expect(line.candidates.map((c) => c.id)).toEqual([forecast]);

    await b.change(id, [{ id: line.id, entryId: forecast }]);
    expect(await (await b.run(id)).json()).toMatchObject({ created: 0, matched: 1 });
    expect(await b.entries()).toEqual([
      expect.objectContaining({ id: forecast, amount: "-19.15", reconciled: true }),
    ]);

    expect(await (await b.undo(id)).json()).toMatchObject({ restored: 1, skipped: 0 });
    expect(await b.entries()).toEqual([
      expect.objectContaining({
        id: forecast,
        amount: "-18.00",
        date: "2026-11-05",
        reconciled: false,
      }),
    ]);
  });

  it("lists the forecasts to choose by hand, and warns about those of the period", async () => {
    const b = await setup();
    const doubled = await b.addEntry("2026-10-28", "-2000.00");
    const later = await b.addEntry("2026-12-05", "-30.00");
    const done = await b.addEntry("2026-10-28", "-40.00", true);
    const id = await b.keep();
    const batch = await b.read(id);
    expect(batch.forecasts.map((e) => e.id)).toEqual([doubled, later]);
    expect(batch.unmatched.map((e) => e.id)).toEqual([doubled]);

    // A forecast takes any amount; a reconciled entry needs the line's.
    const line = batch.lines.find((l) => l.amount === "-1234.56")!;
    expect((await b.change(id, [{ id: line.id, entryId: done }])).status).toBe(400);
    expect((await b.change(id, [{ id: line.id, entryId: doubled }])).status).toBe(204);
    const after = await b.read(id);
    expect(after.unmatched).toEqual([]);
    expect(after.forecasts.map((e) => e.id)).toEqual([later]);
  });

  it("keeps the entries when the batch is deleted", async () => {
    const b = await setup();
    const id = await b.keep();
    const line = (await b.read(id)).lines[0]!;
    await b.change(id, [{ id: line.id, subCategoryId: b.subCategoryId }]);
    await b.run(id);
    expect((await b.owner.request("DELETE", `${b.batches}/${id}`)).status).toBe(204);
    expect(await b.entries()).toHaveLength(1);
  });

  it("is closed to a viewer and to a stranger", async () => {
    const b = await setup();
    const id = await b.keep();
    const line = (await b.read(id)).lines[0]!;
    const stranger = await h.signedInUser();
    const changes = [{ id: line.id, status: "ignored" }];
    for (const [method, path, body] of [
      ["PATCH", `${b.batches}/${id}/lines`, { changes }],
      ["POST", `${b.batches}/${id}/import`, {}],
    ] as const) {
      expect([403, 404]).toContain((await stranger.request(method, path, body)).status);
    }
    expect((await b.read(id)).lines[0]!.status).toBe("review");
  });
});

describe("a line imported as a transfer", () => {
  async function withTransfers() {
    const b = await setup();
    const ref = `/books/${b.bookId}/reference`;
    const made = async (path: string, body: unknown) => {
      const res = await b.owner.request("POST", `${ref}${path}`, body);
      expect(res.status).toBe(201);
      return ((await res.json()) as { id: string }).id;
    };
    const savings = await made("/accounts", {
      names: { fr: "Livret" },
      kind: "bank",
      currency: "EUR",
    });
    const groupId = await made("/groups", { names: { fr: "Mouvements" } });
    const categoryId = await made("/categories", {
      code: "V",
      names: { fr: "Virements" },
      groupId,
      natureId: await defaultNature(b.owner, b.bookId, "transfer"),
    });
    const transferSub = await made("/sub-categories", {
      categoryId,
      names: { fr: "Entre comptes" },
    });
    const id = await b.keep();
    const line = (await b.read(id)).lines.find((l) => l.amount === "-7.20")!;
    const sides = async () =>
      (await b.entries()) as (Entry & { accountId: string; transferId: string | null })[];
    return { ...b, savings, transferSub, id, line, sides };
  }

  it("refuses another sub-category and the batch's own account", async () => {
    const b = await withTransfers();
    const to = (subCategoryId: string, transferAccountId: string) =>
      b.change(b.id, [{ id: b.line.id, subCategoryId, transferAccountId }]);
    expect((await to(b.subCategoryId, b.savings)).status).toBe(400);
    expect((await to(b.transferSub, b.accountId)).status).toBe(400);
    expect((await to(b.transferSub, b.savings)).status).toBe(204);
  });

  it("creates both sides, the other one for its statement to reconcile, and undoes them", async () => {
    const b = await withTransfers();
    await b.change(b.id, [
      { id: b.line.id, subCategoryId: b.transferSub, transferAccountId: b.savings },
    ]);
    expect(await (await b.run(b.id)).json()).toMatchObject({ created: 1 });
    const entries = await b.sides();
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.accountId === b.accountId)).toMatchObject({
      amount: "-7.20",
      reconciled: true,
    });
    const other = entries.find((e) => e.accountId === b.savings)!;
    expect(other).toMatchObject({ amount: "7.20", reconciled: false, date: "2026-10-30" });
    expect(other.transferId).toBe(entries.find((e) => e.id !== other.id)!.transferId);

    // The other account's statement proposes that side.
    const [header] = new TextDecoder().decode(statement).split(/\r?\n/);
    const row = new TextDecoder()
      .decode(statement)
      .split(/\r?\n/)
      .find((l) => l.includes("-7,20"))!
      .replace("-7,20", "7,20");
    const res = await b.owner.request(
      "POST",
      `${b.batches}?preset=boursorama&account=${b.savings}&name=b.csv`,
      new TextEncoder().encode(`${header}\n${row}\n`),
    );
    expect(res.status).toBe(201);
    const second = ((await res.json()) as { id: string }).id;
    expect((await b.read(second)).lines[0]!.candidates.map((c) => c.id)).toEqual([other.id]);

    expect(await (await b.undo(b.id)).json()).toMatchObject({ removed: 1, skipped: 0 });
    expect(await b.sides()).toEqual([]);
  });

  it("keeps the transfer when undoing after the other side was reconciled", async () => {
    const b = await withTransfers();
    await b.change(b.id, [
      { id: b.line.id, subCategoryId: b.transferSub, transferAccountId: b.savings },
    ]);
    await b.run(b.id);
    const other = (await b.sides()).find((e) => e.accountId === b.savings)!;
    const journal = `/books/${b.bookId}/journal`;
    const full = (await b.sides()).find((e) => e.id === other.id) as Entry & { version: number };
    const res = await b.owner.request("PATCH", `${journal}/${other.id}`, {
      version: full.version,
      reconciled: true,
    });
    expect(res.status).toBe(200);
    expect(await (await b.undo(b.id)).json()).toMatchObject({ removed: 0, skipped: 1 });
    expect(await b.sides()).toHaveLength(2);
  });
});

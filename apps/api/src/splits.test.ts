import { afterAll, describe, expect, it } from "vitest";
import { createHarness, household, defaultNature, type DefaultNature } from "../test/harness.js";

const h = createHarness();
afterAll(() => h.sql.end());

interface Entry {
  id: string;
  version: number;
  date: string;
  accountId: string;
  subCategoryId: string;
  amount: string;
  plannedAmount: string;
  reconciled: boolean;
  splitId: string | null;
  splitRemainder: boolean;
  split: { total: string; parts: { id: string; amount: string; remainder: boolean }[] } | null;
}
interface Split {
  id: string;
  version: number;
  parts: Entry[];
}

async function json<T>(response: Response | Promise<Response>, status = 200): Promise<T> {
  const res = await response;
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}

async function status(response: Response | Promise<Response>, expected: number) {
  const res = await response;
  expect(res.status, await res.clone().text()).toBe(expected);
}

/** A EUR book with an account, a rent, a charges and a transfer sub-category. */
async function setup() {
  const owner = await h.signedInUser();
  const { id: bookId } = await json<{ id: string }>(
    owner.request("POST", "/books", household),
    201,
  );
  const url = (path: string) => `/books/${bookId}${path}`;
  const post = <T>(path: string, body: unknown) =>
    json<T & { id: string }>(owner.request("POST", url(path), body), 201);
  const group = await post("/reference/groups", { names: { fr: "Location" } });
  const category = async (code: string, kind: DefaultNature, name: string) =>
    post("/reference/categories", {
      groupId: group.id,
      code,
      natureId: await defaultNature(owner, bookId, kind),
      names: { fr: name },
    });
  const income = await category("R01", "income", "Loyers");
  const costs = await category("C01", "expense", "Charges");
  const moves = await category("T01", "transfer", "Virements");
  const sub = (categoryId: string, name: string) =>
    post("/reference/sub-categories", { categoryId, names: { fr: name } });
  const rent = await sub(income.id, "Loyer brut");
  const fees = await sub(costs.id, "Gestion");
  const move = await sub(moves.id, "Virement interne");
  const account = await post("/reference/accounts", { names: { fr: "Courant" }, currency: "EUR" });

  const parts = (rentAmount = "1000", feesAmount = "-150") => [
    { subCategoryId: rent.id, amount: rentAmount },
    { subCategoryId: fees.id, amount: feesAmount, remainder: true },
  ];
  const body = (overrides: Record<string, unknown> = {}) => ({
    date: "2026-11-05",
    accountId: account.id,
    parts: parts(),
    ...overrides,
  });
  const create = (overrides: Record<string, unknown> = {}, expected = 201) =>
    json<Split>(owner.request("POST", url("/splits"), body(overrides)), expected);
  const journal = async () => {
    const page = await json<{ entries: Entry[] }>(owner.request("GET", url("/journal")));
    return page.entries;
  };
  const budget = {
    year: 2026,
    save: [],
  };
  const plan = (change: Record<string, unknown>) =>
    owner.request("POST", url("/budgets/plan"), { budget, ...change });

  return { owner, url, account, rent, fees, move, parts, body, create, journal, plan, post };
}

describe("splits", () => {
  it("makes parts that share the movement and give the bank amount", async () => {
    const s = await setup();
    const created = await s.create();

    expect(created.parts.map((p) => [p.amount, p.splitRemainder])).toEqual([
      ["1000.00", false],
      ["-150.00", true],
    ]);
    const entries = await s.journal();
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.splitId === created.id)).toBe(true);
    expect(entries[0]!.split!.total).toBe("850.00");
  });

  it("refuses one part, two remainders and a transfer sub-category", async () => {
    const s = await setup();
    await s.create({ parts: s.parts().slice(1) }, 400);
    await s.create({ parts: s.parts().map((p) => ({ ...p, remainder: true })) }, 400);
    await s.create(
      { parts: [s.parts()[0], { subCategoryId: s.move.id, amount: "-1", remainder: true }] },
      400,
    );
    expect(await s.journal()).toEqual([]);
  });

  it("splits an entry, which keeps its planned amount, and dissolves back", async () => {
    const s = await setup();
    const entry = await s.post<Entry>("/journal", {
      date: "2026-11-05",
      accountId: s.account.id,
      subCategoryId: s.fees.id,
      amount: "-100",
      planned: true,
    });
    const split = await s.create({
      parts: [
        { id: entry.id, subCategoryId: s.fees.id, amount: "-80", remainder: true },
        { subCategoryId: s.rent.id, amount: "-20" },
      ],
    });
    const remainder = split.parts.find((p) => p.id === entry.id)!;
    expect([remainder.amount, remainder.plannedAmount]).toEqual(["-80.00", "-100.00"]);

    await json(
      s.owner.request(
        "PATCH",
        s.url(`/splits/${split.id}`),
        s.body({
          version: split.version,
          parts: [{ id: entry.id, subCategoryId: s.fees.id, amount: "-100", remainder: true }],
        }),
      ),
    );
    const entries = await s.journal();
    expect(entries.map((e) => [e.id, e.amount, e.splitId])).toEqual([[entry.id, "-100.00", null]]);
  });

  it("moves and reconciles all parts from one of them", async () => {
    const s = await setup();
    const split = await s.create();
    const [first] = split.parts;

    await json(s.owner.request("PATCH", s.url(`/journal/${first!.id}`), { date: "2026-11-10" }));
    await json(
      s.owner.request("POST", s.url("/journal/reconcile"), {
        ids: [first!.id],
        reconciled: true,
      }),
    );

    const entries = await s.journal();
    expect(entries.map((e) => [e.date, e.reconciled])).toEqual([
      ["2026-11-10", true],
      ["2026-11-10", true],
    ]);
    // A part is not deleted on its own, and an old version of the split is refused.
    await status(s.owner.request("DELETE", s.url(`/journal/${first!.id}`)), 400);
    await status(
      s.owner.request("PATCH", s.url(`/splits/${split.id}`), s.body({ version: split.version })),
      409,
    );
    await status(s.owner.request("DELETE", s.url(`/splits/${split.id}`)), 204);
    expect(await s.journal()).toEqual([]);
  });

  it("saves planned splits, edits two parts at once and removes the whole", async () => {
    const s = await setup();
    const planned = (date: string) => ({
      date,
      accountId: s.account.id,
      parts: s.parts(),
    });
    await status(s.plan({ splits: [planned("2026-01-05"), planned("2026-02-05")] }), 204);

    let entries = await s.journal();
    expect(entries).toHaveLength(4);
    expect(entries.every((e) => e.plannedAmount === e.amount)).toBe(true);
    const january = entries.filter((e) => e.date === "2026-01-05");

    // Both parts change their day: neither version is stale because of the other.
    await status(
      s.plan({
        update: january.map((e) => ({ id: e.id, version: e.version, date: "2026-01-10" })),
      }),
      204,
    );
    entries = await s.journal();
    expect(entries.filter((e) => e.date === "2026-01-10")).toHaveLength(2);

    const one = entries.find((e) => e.date === "2026-01-10")!;
    await status(s.plan({ remove: [{ id: one.id, version: one.version }] }), 204);
    entries = await s.journal();
    expect(entries.map((e) => e.date)).toEqual(["2026-02-05", "2026-02-05"]);
  });

  it("keeps splits from other users", async () => {
    const s = await setup();
    const split = await s.create();
    const other = await h.signedInUser();
    await status(other.request("GET", s.url(`/splits/${split.id}`)), 404);
  });
});

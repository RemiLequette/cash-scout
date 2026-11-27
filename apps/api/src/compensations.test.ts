import { afterAll, describe, expect, it } from "vitest";
import { createHarness, household, defaultNature, type DefaultNature } from "../test/harness.js";

const h = createHarness();
afterAll(() => h.sql.end());

interface Entry {
  id: string;
  date: string;
  accountId: string | null;
  currency: string;
  subCategoryId: string;
  description: string;
  amount: string;
  plannedAmount: string;
  bookAmount: string;
  reconciled: boolean;
  compensationId: string | null;
  compensationSide: "plus" | "minus" | null;
}
interface Compensation {
  id: string;
  version: number;
  plus: Entry;
  minus: Entry;
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

/** A EUR book with an account, an income, a food and a transfer sub-category. */
async function setup() {
  const owner = await h.signedInUser();
  const { id: bookId } = await json<{ id: string }>(
    owner.request("POST", "/books", household),
    201,
  );
  const url = (path: string) => `/books/${bookId}${path}`;
  const post = <T>(path: string, body: unknown) =>
    json<T & { id: string }>(owner.request("POST", url(path), body), 201);
  const group = await post("/reference/groups", { names: { fr: "Vie courante" } });
  const category = async (code: string, kind: DefaultNature, name: string) =>
    post("/reference/categories", {
      groupId: group.id,
      code,
      natureId: await defaultNature(owner, bookId, kind),
      names: { fr: name },
    });
  const food = await category("C01", "expense", "Alimentation");
  const income = await category("R01", "income", "Contributions");
  const moves = await category("T01", "transfer", "Virements");
  const sub = (categoryId: string, name: string) =>
    post("/reference/sub-categories", { categoryId, names: { fr: name } });
  const bakery = await sub(food.id, "Pain");
  const market = await sub(food.id, "Marché");
  const share = await sub(income.id, "Contribution");
  const move = await sub(moves.id, "Virement interne");
  const account = await post("/reference/accounts", { names: { fr: "Courant" }, currency: "EUR" });

  const create = (body: Record<string, unknown> = {}, expected = 201) =>
    json<Compensation>(
      owner.request("POST", url("/compensations"), {
        date: "2026-11-12",
        description: "Courses",
        plusSubCategoryId: share.id,
        minusSubCategoryId: bakery.id,
        amount: "50",
        ...body,
      }),
      expected,
    );
  const journal = (query = "") =>
    json<{ entries: Entry[]; total: number }>(owner.request("GET", url(`/journal${query}`)));
  return {
    owner,
    bookId,
    url,
    post,
    create,
    journal,
    food,
    income,
    bakery,
    market,
    share,
    move,
    account,
  };
}

describe("compensations", () => {
  it("creates two sides without an account, with opposite amounts", async () => {
    const b = await setup();
    const c = await b.create();
    const shared = {
      date: "2026-11-12",
      description: "Courses",
      accountId: null,
      currency: "EUR",
      plannedAmount: "0.00",
      reconciled: true,
      compensationId: c.id,
    };
    expect(c.plus).toMatchObject({
      ...shared,
      compensationSide: "plus",
      subCategoryId: b.share.id,
      amount: "50.00",
      bookAmount: "50.00",
    });
    expect(c.minus).toMatchObject({
      ...shared,
      compensationSide: "minus",
      subCategoryId: b.bakery.id,
      amount: "-50.00",
      bookAmount: "-50.00",
    });
  });

  it("refuses a wrong amount, one sub-category twice and a transfer one", async () => {
    const b = await setup();
    await b.create({ amount: "-50" }, 400);
    await b.create({ amount: "0" }, 400);
    await b.create({ minusSubCategoryId: b.share.id }, 400);
    await b.create({ minusSubCategoryId: b.move.id }, 400);
    expect((await b.journal()).total).toBe(0);
  });

  it("changes and deletes both sides together", async () => {
    const b = await setup();
    const c = await b.create();
    const one = b.url(`/compensations/${c.id}`);
    // Swapped, for a refund.
    const changed = await json<Compensation>(
      b.owner.request("PATCH", one, {
        plusSubCategoryId: b.bakery.id,
        minusSubCategoryId: b.share.id,
        amount: "20",
        date: "2026-11-15",
        version: c.version,
      }),
    );
    expect(changed.plus).toMatchObject({ subCategoryId: b.bakery.id, amount: "20.00" });
    expect(changed.minus).toMatchObject({ subCategoryId: b.share.id, amount: "-20.00" });
    expect(changed.minus.date).toBe("2026-11-15");
    expect(changed.version).toBeGreaterThan(c.version);
    // A change based on the old revision is refused.
    await status(b.owner.request("PATCH", one, { amount: "1", version: c.version }), 409);
    await status(b.owner.request("PATCH", one, { minusSubCategoryId: b.bakery.id }), 400);
    await status(b.owner.request("DELETE", one), 204);
    expect((await b.journal()).total).toBe(0);
  });

  it("does not let one side change, go or be reconciled on its own", async () => {
    const b = await setup();
    const c = await b.create();
    const side = b.url(`/journal/${c.plus.id}`);
    await status(b.owner.request("PATCH", side, { amount: "1" }), 400);
    await status(b.owner.request("PATCH", side, { reconciled: false }), 400);
    await status(b.owner.request("DELETE", side), 400);
    const result = await json<{ updated: number }>(
      b.owner.request("POST", b.url("/journal/reconcile"), {
        ids: [c.plus.id, c.minus.id],
        reconciled: false,
      }),
    );
    expect(result.updated).toBe(0);
  });

  it("filters the journal on compensations", async () => {
    const b = await setup();
    await b.post("/journal", {
      date: "2026-11-10",
      accountId: b.account.id,
      subCategoryId: b.bakery.id,
      amount: "-30",
    });
    const c = await b.create();
    expect((await b.journal()).total).toBe(3);
    const only = await b.journal("?compensations=true");
    expect(only.entries.map((e) => e.compensationId)).toEqual([c.id, c.id]);
    expect((await b.journal(`?accountId=${b.account.id}`)).total).toBe(1);
  });

  it("counts in the categories and their budgets, and in no balance", async () => {
    const b = await setup();
    await b.post("/budgets", {
      categoryId: b.food.id,
      year: 2026,
      months: Array<string>(12).fill("100"),
      accountId: b.account.id,
    });
    await b.create();

    const dashboard = await json<{
      cells: { subCategoryId: string; month: number; total: string }[];
      budgetLines: { categoryId: string; months: string[] }[];
      balances: { accountId: string; ends: string[] }[];
      transfers: unknown[];
    }>(b.owner.request("GET", b.url("/dashboard?year=2026&today=2026-11-23")));
    expect(dashboard.cells).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ subCategoryId: b.share.id, month: 11, total: "50.00" }),
        expect.objectContaining({ subCategoryId: b.bakery.id, month: 11, total: "-50.00" }),
      ]),
    );
    // The month's budget line only expects what the compensation has not used.
    const line = dashboard.budgetLines.find((l) => l.categoryId === b.food.id)!;
    expect(line.months[10]).toBe("-50.00");
    expect(line.months[9]).toBe("-100.00");
    expect(dashboard.transfers).toEqual([]);
    expect(dashboard.balances).toHaveLength(1);
    // Only the budget lines move the balance: ten months of 100, and what is left of November.
    expect(dashboard.balances[0]!.ends[10]).toBe("-1050.00");

    const projection = await json<{ changes: { date: string }[] }[]>(
      b.owner.request(
        "GET",
        b.url("/journal/projection?from=2026-11-01&to=2026-11-29&today=2026-11-01"),
      ),
    );
    expect(projection[0]!.changes.map((change) => change.date)).toEqual([]);
  });

  it("refuses a merge that would give both sides one sub-category", async () => {
    const b = await setup();
    await b.create({ plusSubCategoryId: b.market.id });
    const merge = (id: string, targetId: string) =>
      b.owner.request("POST", b.url(`/reference/sub-categories/${id}/merge`), { targetId });
    await status(merge(b.market.id, b.bakery.id), 400);
    await status(merge(b.bakery.id, b.share.id), 200);
  });

  it("is copied with the book", async () => {
    const b = await setup();
    await b.create();
    const archive = await json<object>(b.owner.request("GET", b.url("/export")));
    const copy = await json<{ id: string }>(b.owner.request("POST", "/books/import", archive), 201);
    const { entries } = await json<{ entries: Entry[] }>(
      b.owner.request("GET", `/books/${copy.id}/journal?compensations=true`),
    );
    expect(entries.map((e) => e.amount).sort()).toEqual(["-50.00", "50.00"]);
    expect(entries[0]!.compensationId).toBe(entries[1]!.compensationId);
  });

  it("is for editors to write", async () => {
    const b = await setup();
    const viewer = await h.signedInUser();
    await status(
      b.owner.request("POST", b.url("/members"), { email: viewer.email, role: "viewer" }),
      201,
    );
    const c = await b.create();
    const one = b.url(`/compensations/${c.id}`);
    await status(viewer.request("GET", one), 200);
    await status(viewer.request("DELETE", one), 403);
    const stranger = await h.signedInUser();
    expect((await stranger.request("GET", one)).status).toBeGreaterThanOrEqual(403);
  });
});

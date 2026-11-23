import { afterAll, describe, expect, it } from "vitest";
import { createHarness, household } from "../test/harness.js";

const h = createHarness();
afterAll(() => h.sql.end());

type User = Awaited<ReturnType<typeof h.signedInUser>>;

async function json<T>(response: Response | Promise<Response>, status = 200): Promise<T> {
  const res = await response;
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}

const even = [834, 833, 833, 834, 833, 833, 834, 833, 833, 834, 833, 833];

/** A EUR book with food (expense) and salary (income), a EUR and a MYR account, an even profile. */
async function setup() {
  const owner = await h.signedInUser();
  const { id: bookId } = await json<{ id: string }>(
    owner.request("POST", "/books", household),
    201,
  );
  const post = <T>(path: string, body: unknown) =>
    json<T & { id: string }>(owner.request("POST", `/books/${bookId}${path}`, body), 201);
  const group = await post("/reference/groups", { names: { fr: "Vie courante" } });
  const food = await post("/reference/categories", {
    groupId: group.id,
    code: "C01",
    direction: "expense",
    names: { fr: "Alimentation" },
  });
  const salary = await post("/reference/categories", {
    groupId: group.id,
    code: "R01",
    direction: "income",
    names: { fr: "Salaires" },
  });
  const bakery = await post("/reference/sub-categories", {
    categoryId: food.id,
    names: { fr: "Pain" },
  });
  const pay = await post("/reference/sub-categories", {
    categoryId: salary.id,
    names: { fr: "Paie" },
  });
  const current = await post("/reference/accounts", {
    names: { fr: "Compte courant" },
    kind: "bank",
    currency: "EUR",
  });
  const ringgit = await post("/reference/accounts", {
    names: { fr: "Compte MYR" },
    kind: "bank",
    currency: "MYR",
  });
  const profile = await post("/budgets/profiles", { names: { fr: "Régulier" }, weights: even });

  const path = (suffix = "") => `/books/${bookId}/budgets${suffix}`;
  const addBudget = (body: Record<string, unknown> = {}) =>
    json(
      owner.request("POST", path(), {
        categoryId: food.id,
        year: 2026,
        type: "periodic",
        amount: "1200",
        profileId: profile.id,
        consumption: "lapse",
        accountId: current.id,
        ...body,
      }),
      201,
    );
  const spend = (subCategoryId: string, date: string, amount: string) =>
    post("/journal", { date, accountId: current.id, subCategoryId, amount });
  const monthEnds = (year = 2026, by: User = owner) =>
    json<MonthEnd[]>(by.request("GET", path(`/month-ends?year=${year}`)));
  const settle = (
    month: number,
    reconciled = true,
    categoryId = food.id,
    by: User = owner,
    year = 2026,
  ) => by.request("POST", path("/settlements"), { categoryId, year, month, reconciled });
  const projection = async (from: string, to: string, today: string) => {
    const all = await json<Projection[]>(
      owner.request(
        "GET",
        `/books/${bookId}/journal/projection?from=${from}&to=${to}&today=${today}`,
      ),
    );
    return all.find((a) => a.accountId === current.id)!;
  };

  return {
    owner,
    bookId,
    path,
    addBudget,
    spend,
    monthEnds,
    settle,
    projection,
    food,
    salary,
    bakery,
    pay,
    current,
    ringgit,
  };
}

interface MonthEnd {
  budgetId: string;
  categoryId: string;
  accountId: string;
  month: number;
  date: string;
  currency: string;
  amount: string;
  bookAmount: string;
  unused: string;
  reconciled: boolean;
}

interface Projection {
  accountId: string;
  currency: string;
  opening: string;
  changes: { date: string; amount: string }[];
}

describe("month-end lines of the unused budget", () => {
  it("puts what a month did not use on the reference account, dated the month's last day", async () => {
    const b = await setup();
    await b.addBudget();
    await b.spend(b.bakery.id, "2026-03-10", "-30");
    await b.spend(b.bakery.id, "2026-02-10", "-150"); // more than the month's share

    const lines = await b.monthEnds();
    expect(lines).toHaveLength(11); // February is overspent: nothing is left
    expect(lines.find((l) => l.month === 2)).toBeUndefined();
    expect(lines.find((l) => l.month === 1)).toMatchObject({
      accountId: b.current.id,
      categoryId: b.food.id,
      date: "2026-01-31",
      currency: "EUR",
      amount: "-100.08",
      unused: "100.08",
      reconciled: false,
    });
    expect(lines.find((l) => l.month === 3)).toMatchObject({
      date: "2026-03-31",
      amount: "-69.96",
      bookAmount: "-69.96",
    });
    expect(await b.monthEnds(2027)).toEqual([]);
  });

  it("is a forecast of income for an income category, in the account currency", async () => {
    const b = await setup();
    await b.addBudget({
      categoryId: b.salary.id,
      accountId: b.ringgit.id,
      exchangeRate: "0.2",
    });
    const [january] = await b.monthEnds();
    // 100.08 EUR of income not received yet, at 1 MYR = 0.2 EUR.
    expect(january).toMatchObject({ currency: "MYR", amount: "500.40", bookAmount: "100.08" });
  });

  it("goes to 0 once settled, and comes back when the settling is taken back", async () => {
    const b = await setup();
    await b.addBudget();
    expect((await b.settle(3)).status).toBe(204);
    expect((await b.settle(3)).status).toBe(204); // twice is the same

    const march = (await b.monthEnds()).find((l) => l.month === 3);
    expect(march).toMatchObject({ amount: "0.00", bookAmount: "0.00", reconciled: true });
    expect(march!.unused).toBe("99.96");

    expect((await b.settle(3, false)).status).toBe(204);
    const again = (await b.monthEnds()).find((l) => l.month === 3);
    expect(again).toMatchObject({ amount: "-99.96", reconciled: false });
  });

  it("keeps a settled month, even one that was overspent since", async () => {
    const b = await setup();
    await b.addBudget();
    await b.settle(2);
    await b.spend(b.bakery.id, "2026-02-10", "-150");
    expect((await b.monthEnds()).find((l) => l.month === 2)).toMatchObject({
      amount: "0.00",
      unused: "0.00",
      reconciled: true,
    });
  });

  it("is a single line at the year's end when the unused budget moves on", async () => {
    const b = await setup();
    await b.addBudget({ consumption: "roll_over" });
    await b.spend(b.bakery.id, "2026-03-10", "-30");
    const lines = await b.monthEnds();
    expect(lines).toHaveLength(1);
    // The whole year's budget less what was spent.
    expect(lines[0]).toMatchObject({ month: 12, date: "2026-12-31", amount: "-1170.00" });
  });

  it("has none for a category without a periodic budget", async () => {
    const b = await setup();
    expect(await b.monthEnds()).toEqual([]);
    expect((await b.settle(3)).status).toBe(400);
    await b.owner.request("POST", b.path(), {
      categoryId: b.food.id,
      year: 2026,
      type: "scheduled",
    });
    expect((await b.settle(3)).status).toBe(400);
    expect((await b.settle(13)).status).toBe(400);
  });

  it("skips a budget from before the account was required", async () => {
    const b = await setup();
    await b.addBudget();
    await h.sql.begin(async (tx) => {
      await tx`select set_config('app.user_id', ${b.owner.id}, true)`;
      await tx`update category_budget set account_id = null, exchange_rate = null where book_id = ${b.bookId}`;
    });
    expect(await b.monthEnds()).toEqual([]);
  });

  it("is read by viewers, settled by editors only, and hidden from others", async () => {
    const b = await setup();
    await b.addBudget();
    const viewer = await h.signedInUser();
    await json(
      b.owner.request("POST", `/books/${b.bookId}/members`, {
        email: viewer.email,
        role: "viewer",
      }),
      201,
    );
    expect(await b.monthEnds(2026, viewer)).toHaveLength(12);
    expect((await b.settle(3, true, b.food.id, viewer)).status).toBe(403);
    const stranger = await h.signedInUser();
    expect((await stranger.request("GET", b.path("/month-ends?year=2026"))).status).toBe(404);
    expect((await b.settle(3, true, b.food.id, stranger)).status).toBe(404);
  });
});

describe("account projection", () => {
  it("gives the opening balance and the daily changes", async () => {
    const b = await setup();
    await b.spend(b.pay.id, "2026-01-05", "1000");
    await b.spend(b.bakery.id, "2026-02-20", "-40");
    await b.spend(b.bakery.id, "2026-03-03", "-10");
    await b.spend(b.bakery.id, "2026-03-03", "-5.50");
    await b.spend(b.bakery.id, "2026-04-01", "-1");
    await b.spend(b.bakery.id, "2026-07-01", "-99"); // after the window

    const result = await b.projection("2026-03-01", "2026-05-31", "2026-03-15");
    expect(result.currency).toBe("EUR");
    expect(result.opening).toBe("960.00");
    expect(result.changes).toEqual([
      { date: "2026-03-03", amount: "-15.50" },
      { date: "2026-04-01", amount: "-1.00" },
    ]);
  });

  it("adds the unused budgets of the months not yet over, unless settled", async () => {
    const b = await setup();
    await b.addBudget();
    await b.settle(4);

    const result = await b.projection("2026-03-01", "2026-05-31", "2026-03-15");
    expect(result.changes).toEqual([
      { date: "2026-03-31", amount: "-99.96" },
      { date: "2026-04-30", amount: "0.00" },
      { date: "2026-05-31", amount: "-99.96" },
    ]);

    // Once March is over, its unsettled budget no longer counts.
    const later = await b.projection("2026-03-01", "2026-05-31", "2026-04-02");
    expect(later.changes.map((c) => c.date)).toEqual(["2026-04-30", "2026-05-31"]);
  });

  it("is read by members only", async () => {
    const b = await setup();
    const stranger = await h.signedInUser();
    const res = await stranger.request(
      "GET",
      `/books/${b.bookId}/journal/projection?from=2026-03-01&to=2026-05-31&today=2026-03-15`,
    );
    expect(res.status).toBe(404);
  });
});

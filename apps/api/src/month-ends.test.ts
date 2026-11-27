import { afterAll, describe, expect, it } from "vitest";
import { createHarness, household, defaultNature } from "../test/harness.js";

const h = createHarness();
afterAll(() => h.sql.end());

type User = Awaited<ReturnType<typeof h.signedInUser>>;

async function json<T>(response: Response | Promise<Response>, status = 200): Promise<T> {
  const res = await response;
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}

/** A EUR book with food (expense) and salary (income), a EUR and a MYR account, grids of 100 a month. */
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
    natureId: await defaultNature(owner, bookId, "expense"),
    names: { fr: "Alimentation" },
  });
  const salary = await post("/reference/categories", {
    groupId: group.id,
    code: "R01",
    natureId: await defaultNature(owner, bookId, "income"),
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
    currency: "EUR",
  });
  const ringgit = await post("/reference/accounts", {
    names: { fr: "Compte MYR" },
    currency: "MYR",
  });

  const path = (suffix = "") => `/books/${bookId}/budgets${suffix}`;
  const addBudget = (body: Record<string, unknown> = {}) =>
    json(
      owner.request("POST", path(), {
        categoryId: food.id,
        year: 2026,
        months: Array<string>(12).fill("100"),
        accountId: current.id,
        ...body,
      }),
      201,
    );
  const spend = (subCategoryId: string, date: string, amount: string, planned = false) =>
    post("/journal", { date, accountId: current.id, subCategoryId, amount, planned });
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
  plannedAmount: string;
  unused: string;
  reconciled: boolean;
}

interface Projection {
  accountId: string;
  currency: string;
  opening: string;
  changes: { date: string; amount: string }[];
}

describe("budget lines", () => {
  it("puts what unplanned entries left on the account, dated the month's last day", async () => {
    const b = await setup();
    await b.addBudget();
    await b.spend(b.bakery.id, "2026-03-10", "-30");
    await b.spend(b.bakery.id, "2026-02-10", "-150"); // more than the month's budget
    await b.spend(b.bakery.id, "2026-04-10", "-80", true); // planned: budgeted on top

    const lines = await b.monthEnds();
    expect(lines).toHaveLength(12); // even a used up month keeps its line
    expect(lines.find((l) => l.month === 1)).toMatchObject({
      accountId: b.current.id,
      categoryId: b.food.id,
      date: "2026-01-31",
      currency: "EUR",
      amount: "-100.00",
      plannedAmount: "-100.00",
      unused: "100.00",
      reconciled: false,
    });
    expect(lines.find((l) => l.month === 2)).toMatchObject({ amount: "0.00", unused: "0.00" });
    expect(lines.find((l) => l.month === 3)).toMatchObject({
      amount: "-70.00",
      bookAmount: "-70.00",
    });
    expect(lines.find((l) => l.month === 4)).toMatchObject({ amount: "-100.00" });
    expect(await b.monthEnds(2027)).toEqual([]);
  });

  it("is raised by a refund, and has none for a month of 0", async () => {
    const b = await setup();
    const months = Array<string>(12).fill("0");
    months[2] = "100";
    await b.addBudget({ months });
    await b.spend(b.bakery.id, "2026-03-10", "40");
    const lines = await b.monthEnds();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ month: 3, amount: "-140.00" });
  });

  it("is a forecast of income for an income category, in the account currency", async () => {
    const b = await setup();
    await b.addBudget({
      categoryId: b.salary.id,
      accountId: b.ringgit.id,
      exchangeRate: "0.2",
    });
    const [january] = await b.monthEnds();
    // 100 EUR of income not received yet, at 1 MYR = 0.2 EUR.
    expect(january).toMatchObject({ currency: "MYR", amount: "500.00", bookAmount: "100.00" });
  });

  it("goes to 0 once reconciled, and comes back when taken back", async () => {
    const b = await setup();
    await b.addBudget();
    expect((await b.settle(3)).status).toBe(204);
    expect((await b.settle(3)).status).toBe(204); // twice is the same

    const march = (await b.monthEnds()).find((l) => l.month === 3);
    expect(march).toMatchObject({
      amount: "0.00",
      plannedAmount: "-100.00",
      unused: "100.00",
      reconciled: true,
    });

    expect((await b.settle(3, false)).status).toBe(204);
    const again = (await b.monthEnds()).find((l) => l.month === 3);
    expect(again).toMatchObject({ amount: "-100.00", reconciled: false });
  });

  it("is only reconciled for a month with a budget", async () => {
    const b = await setup();
    expect(await b.monthEnds()).toEqual([]);
    expect((await b.settle(3)).status).toBe(400);
    await b.addBudget({ months: Array<string>(12).fill("0") });
    expect((await b.settle(3)).status).toBe(400);
    expect((await b.settle(13)).status).toBe(400);
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

  it("adds the budget lines, past months included, reconciled ones at 0", async () => {
    const b = await setup();
    await b.addBudget();
    await b.settle(4);

    const result = await b.projection("2026-03-01", "2026-05-31", "2026-03-15");
    expect(result.changes).toEqual([
      { date: "2026-03-31", amount: "-100.00" },
      { date: "2026-04-30", amount: "0.00" },
      { date: "2026-05-31", amount: "-100.00" },
    ]);

    // Once March is over, what it still expects stays until reconciled.
    const later = await b.projection("2026-03-01", "2026-05-31", "2026-04-02");
    expect(later.changes).toEqual(result.changes);
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

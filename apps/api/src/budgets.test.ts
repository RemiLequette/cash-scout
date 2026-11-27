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

/** A grid with `amount` in every month. */
const every = (amount: string) => Array<string>(12).fill(amount);

interface Budget {
  id: string;
  categoryId: string;
  version: number;
  assumptions: string;
  months: string[];
  accountId: string | null;
  exchangeRate: string | null;
}

interface Year {
  year: number;
  bookCurrency: string;
  budgets: Budget[];
  journal: {
    categoryId: string;
    actual: string[];
    reconciled: string[];
    planned: string[];
    unplanned: string[];
  }[];
}

/** A EUR book with food (expense) and salary (income) categories, a EUR and a MYR account. */
async function bookWithCategories(owner?: User) {
  owner ??= await h.signedInUser();
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

  const budgets = (path = "") => `/books/${bookId}/budgets${path}`;
  const budget = (body: Record<string, unknown> = {}) => ({
    categoryId: food.id,
    year: 2026,
    months: every("100"),
    accountId: current.id,
    ...body,
  });
  const addBudget = (body: Record<string, unknown> = {}) =>
    json<Budget>(owner.request("POST", budgets(), budget(body)), 201);
  const spend = (subCategoryId: string, date: string, amount: string, planned = false) =>
    post("/journal", { date, accountId: current.id, subCategoryId, amount, planned });
  const year = (y = 2026, by: User = owner) => json<Year>(by.request("GET", budgets(`?year=${y}`)));
  const settle = (month: number, reconciled = true, categoryId = food.id) =>
    owner.request("POST", budgets("/settlements"), {
      categoryId,
      year: 2026,
      month,
      reconciled,
    });

  return {
    owner,
    bookId,
    budgets,
    budget,
    addBudget,
    spend,
    year,
    settle,
    food,
    salary,
    bakery,
    pay,
    current,
    ringgit,
    group,
  };
}

describe("category budgets", () => {
  it("keeps 12 monthly amounts, and what the journal holds month by month", async () => {
    const b = await bookWithCategories();
    const months = every("0");
    months[6] = "420";
    await b.addBudget({ months, assumptions: "Summer" });
    await b.spend(b.bakery.id, "2026-07-14", "-100");
    await b.spend(b.bakery.id, "2026-07-20", "-30.50", true);
    await b.spend(b.bakery.id, "2025-07-20", "-999"); // another year
    await json(
      b.owner.request("POST", `/books/${b.bookId}/journal`, {
        date: "2026-07-21",
        accountId: b.current.id,
        subCategoryId: b.bakery.id,
        amount: "-12",
        reconciled: true,
      }),
      201,
    );

    const read = await b.year();
    expect(read.bookCurrency).toBe("EUR");
    expect(read.budgets[0]).toMatchObject({ assumptions: "Summer", accountId: b.current.id });
    expect(read.budgets[0]!.months[6]).toBe("420.00");
    const [food] = read.journal;
    // Read with the nature's sign: spending is positive.
    expect(food!.actual[6]).toBe("142.50");
    expect(food!.reconciled[6]).toBe("12.00");
    expect(food!.unplanned[6]).toBe("112.00");
    expect(food!.planned[6]).toBe("30.50");
    expect((await b.year(2027)).budgets).toEqual([]);
  });

  it("accepts a negative amount: a planned withdrawal", async () => {
    const b = await bookWithCategories();
    const withdrawal = await b.addBudget({ months: every("-250") });
    expect(withdrawal.months[0]).toBe("-250.00");
  });

  it("allows one budget per category and year", async () => {
    const b = await bookWithCategories();
    await b.addBudget();
    expect((await b.owner.request("POST", b.budgets(), b.budget())).status).toBe(409);
    await b.addBudget({ year: 2027 });
  });

  it("requires an account as soon as a month is not zero", async () => {
    const b = await bookWithCategories();
    const refused = await b.owner.request("POST", b.budgets(), b.budget({ accountId: undefined }));
    expect(refused.status).toBe(400);
    // Assumptions alone need none.
    await b.addBudget({ months: every("0"), accountId: undefined, assumptions: "To see" });
  });

  it("has no grid in a transfer category", async () => {
    const b = await bookWithCategories();
    const moves = await json<{ id: string }>(
      b.owner.request("POST", `/books/${b.bookId}/reference/categories`, {
        groupId: b.group.id,
        code: "T01",
        natureId: await defaultNature(b.owner, b.bookId, "transfer"),
        names: { fr: "Virements" },
      }),
      201,
    );
    const refused = await b.owner.request("POST", b.budgets(), b.budget({ categoryId: moves.id }));
    expect(refused.status).toBe(400);
  });

  it("keeps the rate for an account in another currency, and requires it", async () => {
    const b = await bookWithCategories();
    expect(await b.addBudget()).toMatchObject({ exchangeRate: "1" });
    const missing = await b.owner.request(
      "POST",
      b.budgets(),
      b.budget({ categoryId: b.salary.id, accountId: b.ringgit.id }),
    );
    expect(missing.status).toBe(400);
    const foreign = await b.addBudget({
      categoryId: b.salary.id,
      accountId: b.ringgit.id,
      exchangeRate: "0.2",
    });
    expect(foreign).toMatchObject({ accountId: b.ringgit.id, exchangeRate: "0.2" });
  });

  it("locks the grid amount of a reconciled month", async () => {
    const b = await bookWithCategories();
    const budget = await b.addBudget();
    expect((await b.settle(3)).status).toBe(204);

    const march = every("100");
    march[2] = "150";
    const patch = (months: string[]) =>
      b.owner.request("PATCH", b.budgets(`/${budget.id}`), { months });
    expect((await patch(march)).status).toBe(400);
    expect((await b.owner.request("DELETE", b.budgets(`/${budget.id}`))).status).toBe(400);
    const april = every("100");
    april[3] = "150";
    expect((await patch(april)).status).toBe(200);

    expect((await b.settle(3, false)).status).toBe(204);
    expect((await patch(march)).status).toBe(200);
  });

  it("is deleted by its editors", async () => {
    const b = await bookWithCategories();
    const budget = await b.addBudget();
    expect((await b.owner.request("DELETE", b.budgets(`/${budget.id}`))).status).toBe(204);
    expect((await b.owner.request("DELETE", b.budgets(`/${budget.id}`))).status).toBe(404);
  });

  it("refuses a category from another book", async () => {
    const a = await bookWithCategories();
    const other = await bookWithCategories();
    const refused = await a.owner.request(
      "POST",
      a.budgets(),
      a.budget({ categoryId: other.food.id }),
    );
    expect(refused.status).toBe(400);
  });
});

describe("saving the budgets of a year at once", () => {
  type Book = Awaited<ReturnType<typeof bookWithCategories>>;
  const save = (b: Book, body: unknown) => b.owner.request("POST", b.budgets("/batch"), body);
  const item = (b: Book, categoryId: string, amount = "50") =>
    b.budget({ categoryId, year: 2027, months: every(amount) });

  it("creates, replaces and removes budgets together", async () => {
    const b = await bookWithCategories();
    const first = await save(b, {
      year: 2027,
      save: [item(b, b.food.id), item(b, b.salary.id)],
    });
    expect(await first.json()).toEqual({ saved: 2, removed: 0 });
    const read = (await b.year(2027)).budgets;
    const versions = Object.fromEntries(read.map((x) => [x.categoryId, x.version]));
    const second = await save(b, {
      year: 2027,
      save: [item(b, b.food.id, "75")],
      remove: [b.salary.id],
      versions,
    });
    expect(await second.json()).toEqual({ saved: 1, removed: 1 });
    const after = (await b.year(2027)).budgets;
    expect(after).toHaveLength(1);
    expect(after[0]!.months).toEqual(every("75.00"));
  });

  it("refuses everything when one budget is wrong", async () => {
    const b = await bookWithCategories();
    const refused = await save(b, {
      year: 2027,
      save: [item(b, b.food.id), { ...item(b, b.salary.id), accountId: crypto.randomUUID() }],
    });
    expect(refused.status).toBe(400);
    expect((await b.year(2027)).budgets).toEqual([]);
  });

  it("refuses a change made on a budget that moved on since it was read", async () => {
    const b = await bookWithCategories();
    await save(b, { year: 2027, save: [item(b, b.food.id)] });
    const [read] = (await b.year(2027)).budgets;
    const patch = await b.owner.request("PATCH", b.budgets(`/${read!.id}`), {
      months: every("70"),
    });
    expect(patch.status).toBe(200);

    const stale = await save(b, {
      year: 2027,
      save: [item(b, b.food.id, "80")],
      versions: { [b.food.id]: read!.version },
    });
    expect(stale.status).toBe(409);
    // A budget the screen did not know about counts as a conflict too.
    expect((await save(b, { year: 2027, save: [item(b, b.food.id)] })).status).toBe(409);
    expect((await b.year(2027)).budgets[0]!.months).toEqual(every("70.00"));
  });

  it("needs the editor role and budgets of the year", async () => {
    const b = await bookWithCategories();
    expect(
      (await save(b, { year: 2027, save: [{ ...item(b, b.food.id), year: 2026 }] })).status,
    ).toBe(400);
    const viewer = await h.signedInUser();
    await b.owner.request("POST", `/books/${b.bookId}/members`, {
      email: viewer.email,
      role: "viewer",
    });
    const denied = await viewer.request("POST", b.budgets("/batch"), { year: 2027, save: [] });
    expect(denied.status).toBe(403);
  });
});

describe("budget access", () => {
  it("lets viewers read but not write, and hides the book from others", async () => {
    const b = await bookWithCategories();
    const viewer = await h.signedInUser();
    await json(
      b.owner.request("POST", `/books/${b.bookId}/members`, {
        email: viewer.email,
        role: "viewer",
      }),
      201,
    );
    await b.addBudget();

    expect((await b.year(2026, viewer)).budgets).toHaveLength(1);
    const write = await viewer.request("POST", b.budgets(), b.budget({ categoryId: b.salary.id }));
    expect(write.status).toBe(403);

    const stranger = await h.signedInUser();
    expect((await stranger.request("GET", b.budgets("?year=2026"))).status).toBe(404);
  });
});

describe("saving a category's plan", () => {
  it("saves the grid and the entries together, or nothing", async () => {
    const b = await bookWithCategories();
    const entry = (date: string, extra = {}) => ({
      date,
      accountId: b.current.id,
      subCategoryId: b.bakery.id,
      description: "Pain",
      amount: "-20",
      ...extra,
    });
    const batch = (versions = {}) => ({
      year: 2026,
      save: [b.budget()],
      versions,
    });
    const plan = (body: Record<string, unknown>) =>
      b.owner.request("POST", b.budgets("/plan"), body);
    const entries = async () =>
      (
        await json<{
          entries: { id: string; version: number; amount: string; plannedAmount: string }[];
        }>(b.owner.request("GET", `/books/${b.bookId}/journal?limit=50&offset=0`))
      ).entries;

    expect(
      (await plan({ budget: batch(), create: [entry("2026-01-05"), entry("2026-02-05")] })).status,
    ).toBe(204);
    const [second, first] = await entries();
    expect(first).toMatchObject({ amount: "-20.00", plannedAmount: "-20.00" });

    const [saved] = (await b.year()).budgets;
    const change = {
      budget: batch({ [b.food.id]: saved!.version }),
      update: [{ id: first!.id, version: first!.version, amount: "-25", planned: true }],
      remove: [{ id: second!.id, version: second!.version + 1 }], // moved on
    };
    expect((await plan(change)).status).toBe(409);
    expect((await entries()).map((e) => e.amount)).toEqual(["-20.00", "-20.00"]);

    change.remove = [{ id: second!.id, version: second!.version }];
    expect((await plan(change)).status).toBe(204);
    expect(await entries()).toEqual([
      expect.objectContaining({ amount: "-25.00", plannedAmount: "-25.00" }),
    ]);
  });
});

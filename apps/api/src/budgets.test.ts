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
const summer = [300, 300, 300, 300, 300, 300, 3500, 3500, 300, 300, 300, 300];

interface Month {
  allocated: string;
  available: string;
  consumed: string;
  remaining: string;
}
interface Budget {
  id: string;
  categoryId: string;
  type: string;
  amount: string | null;
  profileId: string | null;
  assumptions: string;
  accountId: string | null;
  exchangeRate: string | null;
  months: Month[] | null;
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
  const food = await post<{ defaultBudgetType: string }>("/reference/categories", {
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

  const budgets = (path = "") => `/books/${bookId}/budgets${path}`;
  const addBudget = (body: Record<string, unknown>, by: User = owner) =>
    json<Budget>(
      by.request("POST", budgets(), {
        categoryId: food.id,
        year: 2026,
        type: "periodic",
        amount: "1200",
        profileId: profile.id,
        consumption: "lapse",
        ...body,
      }),
      201,
    );
  const spend = (subCategoryId: string, date: string, amount: string) =>
    post("/journal", { date, accountId: current.id, subCategoryId, amount });
  const year = (y = 2026, by: User = owner) =>
    json<{ year: number; bookCurrency: string; budgets: Budget[] }>(
      by.request("GET", budgets(`?year=${y}`)),
    );

  return {
    owner,
    bookId,
    budgets,
    addBudget,
    spend,
    year,
    food,
    salary,
    bakery,
    pay,
    current,
    ringgit,
    profile,
    group,
  };
}

describe("category default budget type", () => {
  it("is periodic unless said otherwise", async () => {
    const b = await bookWithCategories();
    expect(b.food.defaultBudgetType).toBe("periodic");
    const taxes = await json<{ defaultBudgetType: string }>(
      b.owner.request("POST", `/books/${b.bookId}/reference/categories`, {
        groupId: b.group.id,
        code: "I01",
        direction: "expense",
        defaultBudgetType: "scheduled",
        names: { fr: "Impôts" },
      }),
      201,
    );
    expect(taxes.defaultBudgetType).toBe("scheduled");
  });
});

describe("budget profiles", () => {
  it("lists the book's profiles with their weights", async () => {
    const b = await bookWithCategories();
    const list = await json<{ id: string; weights: number[]; archived: boolean }[]>(
      b.owner.request("GET", b.budgets("/profiles")),
    );
    expect(list).toEqual([
      expect.objectContaining({ id: b.profile.id, weights: even, archived: false }),
    ]);
  });

  it("refuses weights that do not add up, or names outside the book languages", async () => {
    const b = await bookWithCategories();
    const bad = (body: unknown) => b.owner.request("POST", b.budgets("/profiles"), body);
    expect((await bad({ names: { fr: "X" }, weights: [...even.slice(1), 0] })).status).toBe(400);
    expect((await bad({ names: { en: "X" }, weights: even })).status).toBe(400);
  });

  it("is kept by an archive, not deleted while a budget uses it", async () => {
    const b = await bookWithCategories();
    await b.addBudget({});
    expect((await b.owner.request("DELETE", b.budgets(`/profiles/${b.profile.id}`))).status).toBe(
      409,
    );
    const archived = await json<{ archived: boolean }>(
      b.owner.request("PATCH", b.budgets(`/profiles/${b.profile.id}`), { archived: true }),
    );
    expect(archived.archived).toBe(true);
    // An archived profile cannot be chosen for a new budget.
    const refused = await b.owner.request("POST", b.budgets(), {
      categoryId: b.salary.id,
      year: 2026,
      type: "periodic",
      amount: "100",
      profileId: b.profile.id,
      consumption: "lapse",
    });
    expect(refused.status).toBe(400);
  });
});

describe("category budgets", () => {
  it("spreads the annual amount by the profile and shows what the journal consumed", async () => {
    const b = await bookWithCategories();
    const summerProfile = await json<{ id: string }>(
      b.owner.request("POST", b.budgets("/profiles"), {
        names: { fr: "Été" },
        weights: summer,
      }),
      201,
    );
    await b.addBudget({ amount: "1200", profileId: summerProfile.id });
    await b.spend(b.bakery.id, "2026-07-14", "-100");
    await b.spend(b.bakery.id, "2026-07-20", "-30.50");
    await b.spend(b.bakery.id, "2025-07-20", "-999"); // another year

    const { budgets, bookCurrency } = await b.year();
    expect(bookCurrency).toBe("EUR");
    const [food] = budgets;
    expect(food).toMatchObject({ type: "periodic", amount: "1200.00", accountId: null });
    const months = food!.months!;
    expect(months).toHaveLength(12);
    expect(months[0]).toMatchObject({ allocated: "36.00", consumed: "0.00", remaining: "36.00" });
    expect(months[6]).toMatchObject({
      allocated: "420.00",
      consumed: "130.50",
      remaining: "289.50",
    });
    expect(months.reduce((sum, m) => sum + Number(m.allocated), 0)).toBeCloseTo(1200, 2);
    expect((await b.year(2027)).budgets).toEqual([]);
  });

  it("counts income of an income category as consumption, and carries it by mode", async () => {
    const b = await bookWithCategories();
    await b.addBudget({ categoryId: b.salary.id, amount: "1200", consumption: "roll_over" });
    await b.spend(b.pay.id, "2026-01-28", "250");
    const [salary] = (await b.year()).budgets;
    const months = salary!.months!;
    // 8.34 % of 1200 = 100.08 in January; 250 earned is 149.92 over it.
    expect(months[0]).toMatchObject({
      allocated: "100.08",
      available: "100.08",
      consumed: "250.00",
      remaining: "-149.92",
    });
    // February: its own 99.96, less what January overspent.
    expect(months[1]).toMatchObject({ allocated: "99.96", available: "-49.96" });
  });

  it("accepts a negative amount only in a saving category: a planned withdrawal", async () => {
    const b = await bookWithCategories();
    const insurance = await json<{ id: string }>(
      b.owner.request("POST", `/books/${b.bookId}/reference/categories`, {
        groupId: b.group.id,
        code: "E01",
        direction: "saving",
        names: { fr: "Assurance vie" },
      }),
      201,
    );
    const withdrawal = await b.addBudget({ categoryId: insurance.id, amount: "-3000" });
    expect(withdrawal.amount).toBe("-3000.00");
    const negative = await b.owner.request("POST", b.budgets(), {
      categoryId: b.food.id,
      year: 2026,
      type: "periodic",
      amount: "-10",
      profileId: b.profile.id,
      consumption: "lapse",
    });
    expect(negative.status).toBe(400);
  });

  it("keeps a scheduled budget to its type and assumptions", async () => {
    const b = await bookWithCategories();
    const scheduled = await json<Budget>(
      b.owner.request("POST", b.budgets(), {
        categoryId: b.food.id,
        year: 2026,
        type: "scheduled",
        assumptions: "Rent +3 % in July",
      }),
      201,
    );
    expect(scheduled).toMatchObject({
      type: "scheduled",
      amount: null,
      assumptions: "Rent +3 % in July",
    });
    expect((await b.year()).budgets[0]!.months).toBeNull();
    const withAmount = await b.owner.request("POST", b.budgets(), {
      categoryId: b.salary.id,
      year: 2026,
      type: "scheduled",
      amount: "10",
    });
    expect(withAmount.status).toBe(400);
  });

  it("allows one budget per category and year", async () => {
    const b = await bookWithCategories();
    await b.addBudget({});
    const again = await b.owner.request("POST", b.budgets(), {
      categoryId: b.food.id,
      year: 2026,
      type: "scheduled",
    });
    expect(again.status).toBe(409);
    await b.addBudget({ year: 2027 });
  });

  it("keeps the rate for an account in another currency, and requires it", async () => {
    const b = await bookWithCategories();
    const same = await b.addBudget({ accountId: b.current.id });
    expect(same).toMatchObject({ accountId: b.current.id, exchangeRate: "1" });

    const missing = await b.owner.request("POST", b.budgets(), {
      categoryId: b.salary.id,
      year: 2026,
      type: "periodic",
      amount: "100",
      profileId: b.profile.id,
      consumption: "lapse",
      accountId: b.ringgit.id,
    });
    expect(missing.status).toBe(400);

    const foreign = await b.addBudget({
      categoryId: b.salary.id,
      accountId: b.ringgit.id,
      exchangeRate: "0.2",
    });
    expect(foreign).toMatchObject({ accountId: b.ringgit.id, exchangeRate: "0.2" });
  });

  it("revises the amount, re-spreading it, and can drop to a scheduled budget", async () => {
    const b = await bookWithCategories();
    const budget = await b.addBudget({});
    const revised = await json<Budget>(
      b.owner.request("PATCH", b.budgets(`/${budget.id}`), { amount: "2400" }),
    );
    expect(revised.amount).toBe("2400.00");
    const months = (await b.year()).budgets[0]!.months!;
    expect(months.reduce((sum, m) => sum + Number(m.allocated), 0)).toBeCloseTo(2400, 2);

    const scheduled = await json<Budget>(
      b.owner.request("PATCH", b.budgets(`/${budget.id}`), {
        type: "scheduled",
        amount: null,
        profileId: null,
        consumption: null,
      }),
    );
    expect(scheduled).toMatchObject({ type: "scheduled", amount: null, profileId: null });

    // And back to periodic: the whole plan has to be given again.
    const incomplete = await b.owner.request("PATCH", b.budgets(`/${budget.id}`), {
      type: "periodic",
    });
    expect(incomplete.status).toBe(400);
  });

  it("is deleted by its editors", async () => {
    const b = await bookWithCategories();
    const budget = await b.addBudget({});
    expect((await b.owner.request("DELETE", b.budgets(`/${budget.id}`))).status).toBe(204);
    expect((await b.owner.request("DELETE", b.budgets(`/${budget.id}`))).status).toBe(404);
  });

  it("refuses a category from another book", async () => {
    const a = await bookWithCategories();
    const other = await bookWithCategories();
    const refused = await a.owner.request("POST", a.budgets(), {
      categoryId: other.food.id,
      year: 2026,
      type: "scheduled",
    });
    expect(refused.status).toBe(400);
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
    await b.addBudget({});

    expect((await b.year(2026, viewer)).budgets).toHaveLength(1);
    expect(
      (
        await viewer.request("POST", b.budgets(), {
          categoryId: b.salary.id,
          year: 2026,
          type: "scheduled",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await viewer.request("POST", b.budgets("/profiles"), {
          names: { fr: "X" },
          weights: even,
        })
      ).status,
    ).toBe(403);

    const stranger = await h.signedInUser();
    expect((await stranger.request("GET", b.budgets("?year=2026"))).status).toBe(404);
    expect((await stranger.request("GET", b.budgets("/profiles"))).status).toBe(404);
  });
});

import { afterAll, describe, expect, it } from "vitest";
import { createHarness, household, defaultNature, type DefaultNature } from "../test/harness.js";

const h = createHarness();
afterAll(() => h.sql.end());

async function json<T>(response: Response | Promise<Response>, status = 200): Promise<T> {
  const res = await response;
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}

const even = [834, 833, 833, 834, 833, 833, 834, 833, 833, 834, 833, 833];

interface Dashboard {
  year: number;
  bookCurrency: string;
  currentMonth: number;
  cells: { subCategoryId: string; month: number; total: string; entries: number }[];
  unused: { categoryId: string; months: string[] }[];
  balances: { accountId: string; ends: string[] }[];
}

/** A EUR book: food (expense, with a budget), salary (income), a transfer category, two accounts. */
async function setup() {
  const owner = await h.signedInUser();
  const { id: bookId } = await json<{ id: string }>(
    owner.request("POST", "/books", household),
    201,
  );
  const post = <T>(path: string, body: unknown) =>
    json<T & { id: string }>(owner.request("POST", `/books/${bookId}${path}`, body), 201);
  const group = await post("/reference/groups", { names: { fr: "Vie courante" } });
  const category = async (code: string, kind: DefaultNature, name: string) =>
    post("/reference/categories", {
      groupId: group.id,
      code,
      natureId: await defaultNature(owner, bookId, kind),
      names: { fr: name },
    });
  const food = await category("C01", "expense", "Alimentation");
  const salary = await category("R01", "income", "Salaires");
  const moves = await category("T01", "transfer", "Virements");
  const sub = (categoryId: string, name: string) =>
    post("/reference/sub-categories", { categoryId, names: { fr: name } });
  const bakery = await sub(food.id, "Pain");
  const pay = await sub(salary.id, "Paie");
  const move = await sub(moves.id, "Virement interne");
  const account = (name: string, kind: string) =>
    post("/reference/accounts", { names: { fr: name }, kind, currency: "EUR" });
  const current = await account("Compte courant", "bank");
  const saving = await account("Livret", "bank");
  const virtual = await account("Compensations", "virtual");
  const profile = await post("/budgets/profiles", { names: { fr: "Régulier" }, weights: even });

  const entry = (accountId: string, subCategoryId: string, date: string, amount: string) =>
    post("/journal", { date, accountId, subCategoryId, amount });
  const dashboard = (by = owner, query = "year=2026&today=2026-11-23") =>
    by.request("GET", `/books/${bookId}/dashboard?${query}`);

  return {
    owner,
    bookId,
    post,
    entry,
    dashboard,
    profile,
    food,
    salary,
    bakery,
    pay,
    move,
    current,
    saving,
    virtual,
  };
}

describe("year dashboard", () => {
  it("sums the entries per sub-category and month, leaving transfers out", async () => {
    const b = await setup();
    await b.entry(b.current.id, b.bakery.id, "2026-11-10", "-30");
    await b.entry(b.current.id, b.bakery.id, "2026-11-12", "-12.50");
    await b.entry(b.current.id, b.pay.id, "2026-11-25", "2000"); // a forecast: still counted
    await b.entry(b.current.id, b.move.id, "2026-11-26", "-500");
    await b.entry(b.current.id, b.bakery.id, "2025-11-10", "-99"); // another year

    const data = await json<Dashboard>(b.dashboard());
    expect(data).toMatchObject({ year: 2026, bookCurrency: "EUR", currentMonth: 11 });
    expect(data.cells).toHaveLength(2);
    expect(data.cells).toContainEqual({
      subCategoryId: b.bakery.id,
      month: 11,
      total: "-42.50",
      entries: 2,
    });
    expect(data.cells).toContainEqual({
      subCategoryId: b.pay.id,
      month: 11,
      total: "2000.00",
      entries: 1,
    });
  });

  it("leaves the unused budget of the months ahead for a periodic category", async () => {
    const b = await setup();
    await json(
      b.owner.request("POST", `/books/${b.bookId}/budgets`, {
        categoryId: b.food.id,
        year: 2026,
        type: "periodic",
        amount: "1200",
        profileId: b.profile.id,
        consumption: "lapse",
        accountId: b.current.id,
      }),
      201,
    );
    await b.entry(b.current.id, b.bakery.id, "2026-11-10", "-30");
    await b.entry(b.current.id, b.bakery.id, "2026-12-05", "-150"); // a known entry, past the share

    const data = await json<Dashboard>(b.dashboard());
    expect(data.unused).toHaveLength(1);
    const { categoryId, months } = data.unused[0]!;
    expect(categoryId).toBe(b.food.id);
    // Up to the current month, the entries tell what was consumed: no unused budget.
    expect(months.slice(0, 11)).toEqual(Array(11).fill("0.00"));
    // December's share (99.96) is used up by its entry.
    expect(months[11]).toBe("0.00");

    // Seen from earlier in the year, the months ahead keep their share.
    const early = await json<Dashboard>(b.dashboard(b.owner, "year=2026&today=2026-02-10"));
    const ahead = early.unused[0]!.months;
    expect(ahead[0]).toBe("0.00");
    expect(ahead[1]).toBe("0.00");
    expect(ahead[2]).toBe("-99.96"); // March, an expense: negative like the entries
    expect(ahead[10]).toBe("-69.96"); // November: -30 is already entered, the rest is unused
  });

  it("gives the balance of each bank account at the end of each month", async () => {
    const b = await setup();
    await b.entry(b.current.id, b.bakery.id, "2025-12-20", "-100"); // opening balance of 2026
    await b.entry(b.current.id, b.pay.id, "2026-03-05", "2000");
    await b.entry(b.current.id, b.bakery.id, "2026-11-10", "-30");
    await b.entry(b.saving.id, b.move.id, "2026-03-06", "500"); // a transfer still moves the balance
    await b.entry(b.virtual.id, b.move.id, "2026-03-06", "700");

    const { balances } = await json<Dashboard>(b.dashboard());
    expect(balances.map((a) => a.accountId).sort()).toEqual([b.current.id, b.saving.id].sort());
    const current = balances.find((a) => a.accountId === b.current.id)!;
    expect(current.ends[0]).toBe("-100.00");
    expect(current.ends[1]).toBe("-100.00");
    expect(current.ends[2]).toBe("1900.00");
    expect(current.ends[10]).toBe("1870.00");
    expect(current.ends[11]).toBe("1870.00");
    const saving = balances.find((a) => a.accountId === b.saving.id)!;
    expect(saving.ends[1]).toBe("0.00");
    expect(saving.ends[2]).toBe("500.00");
  });

  it("counts the unused budget of the months ahead in the future balances", async () => {
    const b = await setup();
    await json(
      b.owner.request("POST", `/books/${b.bookId}/budgets`, {
        categoryId: b.food.id,
        year: 2026,
        type: "periodic",
        amount: "1200",
        profileId: b.profile.id,
        consumption: "lapse",
        accountId: b.current.id,
      }),
      201,
    );
    await b.entry(b.current.id, b.pay.id, "2026-10-05", "2000");
    await b.entry(b.current.id, b.bakery.id, "2026-11-10", "-30");

    const { balances } = await json<Dashboard>(b.dashboard());
    const { ends } = balances.find((a) => a.accountId === b.current.id)!;
    // Past months stand as the entries made them, whatever their budget left.
    expect(ends[9]).toBe("2000.00");
    // November: -30 entered, and -69.96 of its budget still expected.
    expect(ends[10]).toBe("1900.04");
    expect(ends[11]).toBe("1800.08");
  });

  it("is open to members and closed to others", async () => {
    const b = await setup();
    const stranger = await h.signedInUser();
    expect((await b.dashboard(stranger)).status).toBe(404);
    expect((await b.dashboard(b.owner, "year=1999&today=2026-11-23")).status).toBe(400);
  });
});

import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createHarness, household } from "../test/harness.js";
import { withUser } from "./db/client.js";
import { journalEntry } from "./db/schema.js";

const h = createHarness();
afterAll(() => h.sql.end());

type User = Awaited<ReturnType<typeof h.signedInUser>>;

interface Entry {
  id: string;
  date: string;
  accountId: string;
  subCategoryId: string;
  description: string;
  paymentTypeId: string | null;
  currency: string;
  amount: string;
  plannedAmount: string;
  variance: string;
  exchangeRate: string;
  bookAmount: string;
  originalAmount: string | null;
  originalCurrency: string | null;
  reconciled: boolean;
}

async function json<T>(response: Response | Promise<Response>, status = 200): Promise<T> {
  const res = await response;
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}

/** A EUR book with a EUR and a MYR account, food and salary categories, a payment type. */
async function bookWithReference(owner?: User) {
  owner ??= await h.signedInUser();
  const { id: bookId } = await json<{ id: string }>(
    owner.request("POST", "/books", household),
    201,
  );
  const ref = (path: string) => `/books/${bookId}/reference${path}`;
  const post = <T>(path: string, body: unknown) =>
    json<T & { id: string }>(owner.request("POST", ref(path), body), 201);

  const group = await post("/groups", { names: { fr: "Vie courante" } });
  const food = await post("/categories", {
    groupId: group.id,
    code: "C01",
    direction: "expense",
    names: { fr: "Alimentation" },
  });
  const salary = await post("/categories", {
    groupId: group.id,
    code: "R01",
    direction: "income",
    names: { fr: "Salaires" },
  });
  const bakery = await post("/sub-categories", { categoryId: food.id, names: { fr: "Pain" } });
  const market = await post("/sub-categories", { categoryId: food.id, names: { fr: "Marché" } });
  const pay = await post("/sub-categories", { categoryId: salary.id, names: { fr: "Paie" } });
  const current = await post("/accounts", {
    names: { fr: "Compte courant" },
    kind: "bank",
    currency: "EUR",
  });
  const ringgit = await post("/accounts", {
    names: { fr: "Compte MYR" },
    kind: "bank",
    currency: "MYR",
  });
  const card = await post("/payment-types", { names: { fr: "Carte" } });

  const journal = (path = "") => `/books/${bookId}/journal${path}`;
  const add = (body: Record<string, unknown>, by: User = owner) =>
    json<Entry>(
      by.request("POST", journal(), {
        date: "2026-11-02",
        accountId: current.id,
        subCategoryId: bakery.id,
        amount: "-12.50",
        ...body,
      }),
      201,
    );
  return {
    owner,
    bookId,
    ref,
    journal,
    add,
    food,
    salary,
    bakery,
    market,
    pay,
    current,
    ringgit,
    card,
  };
}

describe("journal entries", () => {
  it("creates an entry with its book amount, and no planned amount", async () => {
    const b = await bookWithReference();
    const entry = await b.add({ description: "Boulangerie", paymentTypeId: b.card.id });
    expect(entry).toMatchObject({
      date: "2026-11-02",
      currency: "EUR",
      amount: "-12.50",
      plannedAmount: "0.00",
      variance: "-12.50",
      exchangeRate: "1",
      bookAmount: "-12.50",
      reconciled: false,
      paymentTypeId: b.card.id,
    });
  });

  it("keeps the sign as entered, whatever the category's direction", async () => {
    const b = await bookWithReference();
    // A refund is positive spending; a tax withheld is negative income.
    expect((await b.add({ amount: "8" })).amount).toBe("8.00");
    expect((await b.add({ subCategoryId: b.pay.id, amount: "-100" })).amount).toBe("-100.00");
  });

  it("requires a rate when the account is in another currency", async () => {
    const b = await bookWithReference();
    const missing = await b.owner.request("POST", b.journal(), {
      date: "2026-11-02",
      accountId: b.ringgit.id,
      subCategoryId: b.bakery.id,
      amount: "-100",
    });
    expect(missing.status).toBe(400);

    const entry = await b.add({
      accountId: b.ringgit.id,
      amount: "-100",
      exchangeRate: "0.2",
      originalAmount: "-21.30",
      originalCurrency: "USD",
    });
    expect(entry).toMatchObject({
      currency: "MYR",
      amount: "-100.00",
      exchangeRate: "0.2",
      bookAmount: "-20.00",
      originalAmount: "-21.30",
      originalCurrency: "USD",
    });
  });

  it("rejects amounts with too many decimals", async () => {
    const b = await bookWithReference();
    const response = await b.owner.request("POST", b.journal(), {
      date: "2026-11-02",
      accountId: b.current.id,
      subCategoryId: b.bakery.id,
      amount: "-1.234",
    });
    expect(response.status).toBe(400);
  });

  it("plans an entry made as part of the plan: the planned amount is the amount", async () => {
    const b = await bookWithReference();
    const entry = await b.add({ amount: "-120", planned: true });
    expect(entry).toMatchObject({ amount: "-120.00", plannedAmount: "-120.00", variance: "0.00" });
  });

  it("changes the amount but never the planned amount", async () => {
    const b = await bookWithReference();
    const entry = await b.add({ amount: "-120", planned: true });
    await json(b.owner.request("PATCH", b.journal(`/${entry.id}`), { amount: "-135" }));
    const updated = await json<Entry>(
      b.owner.request("PATCH", b.journal(`/${entry.id}`), {
        amount: "-138",
        reconciled: true,
        plannedAmount: "0",
      }),
    );
    expect(updated).toMatchObject({
      amount: "-138.00",
      plannedAmount: "-120.00",
      variance: "-18.00",
      bookAmount: "-138.00",
      reconciled: true,
    });
  });

  it("keeps the saved rate unless a new one is given", async () => {
    const b = await bookWithReference();
    const entry = await b.add({ accountId: b.ringgit.id, amount: "-100", exchangeRate: "0.2" });
    const amountChanged = await json<Entry>(
      b.owner.request("PATCH", b.journal(`/${entry.id}`), { amount: "-50" }),
    );
    expect(amountChanged).toMatchObject({ exchangeRate: "0.2", bookAmount: "-10.00" });
    const rateChanged = await json<Entry>(
      b.owner.request("PATCH", b.journal(`/${entry.id}`), { exchangeRate: "0.21" }),
    );
    expect(rateChanged).toMatchObject({ exchangeRate: "0.21", bookAmount: "-10.50" });
  });

  it("does not move an entry to an account in another currency", async () => {
    const b = await bookWithReference();
    const entry = await b.add({});
    const response = await b.owner.request("PATCH", b.journal(`/${entry.id}`), {
      accountId: b.ringgit.id,
    });
    expect(response.status).toBe(400);
  });

  it("refuses archived items for new entries but keeps them on existing ones", async () => {
    const b = await bookWithReference();
    const entry = await b.add({});
    await json(
      b.owner.request("PATCH", b.ref(`/sub-categories/${b.bakery.id}`), { archived: true }),
    );
    await json(b.owner.request("PATCH", b.ref(`/accounts/${b.current.id}`), { archived: true }));

    const onArchived = await b.owner.request("POST", b.journal(), {
      date: "2026-11-03",
      accountId: b.current.id,
      subCategoryId: b.market.id,
      amount: "-1",
    });
    expect(onArchived.status).toBe(400);
    const toArchived = await b.owner.request("PATCH", b.journal(`/${entry.id}`), {
      subCategoryId: b.market.id,
    });
    expect(toArchived.status).toBe(200);
    const back = await b.owner.request("PATCH", b.journal(`/${entry.id}`), {
      subCategoryId: b.bakery.id,
    });
    expect(back.status).toBe(400);
    const edited = await b.owner.request("PATCH", b.journal(`/${entry.id}`), { amount: "-2" });
    expect(edited.status).toBe(200);
  });

  it("refuses another book's items", async () => {
    const mine = await bookWithReference();
    const theirs = await bookWithReference();
    const response = await mine.owner.request("POST", mine.journal(), {
      date: "2026-11-02",
      accountId: theirs.current.id,
      subCategoryId: mine.bakery.id,
      amount: "-1",
    });
    expect(response.status).toBe(400);
  });

  it("deletes an entry", async () => {
    const b = await bookWithReference();
    const entry = await b.add({});
    expect((await b.owner.request("DELETE", b.journal(`/${entry.id}`))).status).toBe(204);
    expect((await b.owner.request("DELETE", b.journal(`/${entry.id}`))).status).toBe(404);
  });
});

describe("journal list and balances", () => {
  async function filled() {
    const b = await bookWithReference();
    const a = await b.add({ date: "2026-10-30", amount: "-10", description: "Pain complet" });
    const c = await b.add({ date: "2026-11-05", subCategoryId: b.market.id, amount: "-20" });
    const d = await b.add({ date: "2026-11-28", subCategoryId: b.pay.id, amount: "2000" });
    const e = await b.add({
      date: "2026-11-10",
      accountId: b.ringgit.id,
      amount: "-50",
      exchangeRate: "0.2",
    });
    return { ...b, a, c, d, e };
  }
  type List = { total: number; bookCurrency: string; entries: Entry[] };
  const ids = (list: List) => list.entries.map((e) => e.id);

  it("filters by period, account, category, sub-category, status and text", async () => {
    const b = await filled();
    const get = (query: string) => json<List>(b.owner.request("GET", b.journal(`?${query}`)));

    const all = await get("");
    expect(all.total).toBe(4);
    expect(all.bookCurrency).toBe("EUR");
    // Newest first.
    expect(ids(all)).toEqual([b.d.id, b.e.id, b.c.id, b.a.id]);

    expect(ids(await get("from=2026-11-01&to=2026-11-10"))).toEqual([b.e.id, b.c.id]);
    expect(ids(await get(`accountId=${b.ringgit.id}`))).toEqual([b.e.id]);
    expect(ids(await get(`categoryId=${b.food.id}`))).toEqual([b.e.id, b.c.id, b.a.id]);
    expect(ids(await get(`subCategoryId=${b.market.id}`))).toEqual([b.c.id]);
    expect(ids(await get(`subCategoryIds=${b.market.id},${b.pay.id}`))).toEqual([b.d.id, b.c.id]);
    expect(ids(await get("subCategoryIds="))).toEqual([]);
    expect(ids(await get("months=2026-10,2026-11"))).toEqual([b.d.id, b.e.id, b.c.id, b.a.id]);
    expect(ids(await get("months=2026-10"))).toEqual([b.a.id]);
    expect(ids(await get("months="))).toEqual([]);

    const months = await json<{ month: string; entries: number }[]>(
      b.owner.request("GET", b.journal("/months")),
    );
    expect(months).toEqual([
      { month: "2026-10", entries: 1 },
      { month: "2026-11", entries: 3 },
    ]);
    expect(ids(await get("q=COMPLET"))).toEqual([b.a.id]);
    expect(ids(await get("q=%25"))).toEqual([]);

    const page = await get("limit=2&offset=2");
    expect(page.total).toBe(4);
    expect(ids(page)).toEqual([b.c.id, b.a.id]);
  });

  it("reconciles in bulk and gives balances per account", async () => {
    const b = await filled();
    const result = await json<{ updated: number }>(
      b.owner.request("POST", b.journal("/reconcile"), {
        ids: [b.a.id, b.c.id, b.e.id],
        reconciled: true,
      }),
    );
    expect(result.updated).toBe(3);
    const reconciled = await json<List>(b.owner.request("GET", b.journal("?reconciled=false")));
    expect(ids(reconciled)).toEqual([b.d.id]);

    const balances = await json<
      { accountId: string; currency: string; reconciled: string; total: string }[]
    >(b.owner.request("GET", b.journal("/balances")));
    expect(balances).toHaveLength(2);
    expect(balances).toEqual(
      expect.arrayContaining([
        { accountId: b.current.id, currency: "EUR", reconciled: "-30.00", total: "1970.00" },
        { accountId: b.ringgit.id, currency: "MYR", reconciled: "-50.00", total: "-50.00" },
      ]),
    );
  });
});

describe("frequent descriptions", () => {
  it("gives the most used ones with their latest entry, without forecasts", async () => {
    const b = await bookWithReference();
    const daysAgo = (days: number) => {
      const date = new Date();
      date.setDate(date.getDate() - days);
      return date.toISOString().slice(0, 10);
    };
    const add = (description: string, days: number, extra: Record<string, unknown> = {}) =>
      b.add({ description, date: daysAgo(days), reconciled: true, ...extra });
    await add("Boulangerie Paul", 30);
    await add("boulangerie paul ", 20);
    const latest = await add("Boulangerie Paul", 10, {
      amount: "-4.20",
      subCategoryId: b.market.id,
    });
    await add("Carrefour", 40);
    await add("Carrefour", 50);
    // Planned: a forecast carries the same description.
    await add("Loyer", 15);
    await add("Loyer", 45);
    await add("Loyer", 75);
    await add("Loyer", -5, { reconciled: false });
    // Too old to count.
    for (const days of [400, 410, 420, 430]) await add("Ancien magasin", days);
    // No description.
    await add("", 5);
    await add("", 6);
    await add("", 7);

    const frequent = await json<{ uses: number; entry: Entry }[]>(
      b.owner.request("GET", b.journal("/frequent")),
    );
    expect(frequent.map((f) => [f.entry.description, f.uses])).toEqual([
      ["Boulangerie Paul", 3],
      ["Carrefour", 2],
    ]);
    expect(frequent[0]!.entry.id).toBe(latest.id);
    expect(frequent[0]!.entry.amount).toBe("-4.20");
  });
});

describe("merging sub-categories", () => {
  it("moves the entries to the target and deletes the source", async () => {
    const b = await bookWithReference();
    const one = await b.add({});
    const two = await b.add({});
    // A sub-category in use cannot be deleted.
    expect((await b.owner.request("DELETE", b.ref(`/sub-categories/${b.bakery.id}`))).status).toBe(
      409,
    );

    const result = await json<{ moved: number }>(
      b.owner.request("POST", b.ref(`/sub-categories/${b.bakery.id}/merge`), {
        targetId: b.market.id,
      }),
    );
    expect(result.moved).toBe(2);
    const list = await json<{ entries: Entry[] }>(b.owner.request("GET", b.journal()));
    expect(list.entries.map((e) => [e.id, e.subCategoryId]).sort()).toEqual(
      [
        [one.id, b.market.id],
        [two.id, b.market.id],
      ].sort(),
    );
    const reference = await json<{ subCategories: { id: string }[] }>(
      b.owner.request("GET", b.ref("")),
    );
    expect(reference.subCategories.map((s) => s.id)).not.toContain(b.bakery.id);
  });

  it("refuses a target in another book or the source itself", async () => {
    const mine = await bookWithReference();
    const theirs = await bookWithReference();
    await mine.add({});
    const other = await mine.owner.request(
      "POST",
      mine.ref(`/sub-categories/${mine.bakery.id}/merge`),
      { targetId: theirs.market.id },
    );
    expect(other.status).toBe(400);
    const itself = await mine.owner.request(
      "POST",
      mine.ref(`/sub-categories/${mine.bakery.id}/merge`),
      { targetId: mine.bakery.id },
    );
    expect(itself.status).toBe(400);
  });
});

describe("journal roles and isolation", () => {
  it("lets viewers read but not write, and editors write", async () => {
    const b = await bookWithReference();
    const entry = await b.add({});
    const viewer = await h.signedInUser();
    const editor = await h.signedInUser();
    for (const [user, role] of [
      [viewer, "viewer"],
      [editor, "editor"],
    ] as const) {
      await json(
        b.owner.request("POST", `/books/${b.bookId}/members`, { email: user.email, role }),
        201,
      );
    }

    expect((await viewer.request("GET", b.journal())).status).toBe(200);
    expect((await viewer.request("GET", b.journal("/balances"))).status).toBe(200);
    expect(
      (await viewer.request("PATCH", b.journal(`/${entry.id}`), { amount: "-1" })).status,
    ).toBe(403);
    expect(
      (
        await viewer.request("POST", b.journal("/reconcile"), {
          ids: [entry.id],
          reconciled: true,
        })
      ).status,
    ).toBe(403);
    expect((await viewer.request("DELETE", b.journal(`/${entry.id}`))).status).toBe(403);

    await b.add({}, editor);
    expect(
      (await editor.request("PATCH", b.journal(`/${entry.id}`), { amount: "-1" })).status,
    ).toBe(200);
  });

  it("hides entries from other users, even without a filter", async () => {
    const b = await bookWithReference();
    const entry = await b.add({});
    const stranger = await h.signedInUser();

    expect((await stranger.request("GET", b.journal())).status).toBe(404);
    expect(
      (await stranger.request("PATCH", b.journal(`/${entry.id}`), { amount: "-1" })).status,
    ).toBe(404);

    const seen = await withUser(h.db, stranger.id, (tx) => tx.select().from(journalEntry));
    expect(seen).toEqual([]);
    const updated = await withUser(h.db, stranger.id, (tx) =>
      tx.execute(sql`update journal_entry set amount = 0 returning id`),
    );
    expect(updated.length).toBe(0);
    const deleted = await withUser(h.db, stranger.id, (tx) =>
      tx.execute(sql`delete from journal_entry returning id`),
    );
    expect(deleted.length).toBe(0);
  });

  it("refuses direct writes into another user's book", async () => {
    const b = await bookWithReference();
    const stranger = await bookWithReference();
    const insert = withUser(h.db, stranger.owner.id, (tx) =>
      tx.insert(journalEntry).values({
        bookId: b.bookId,
        date: "2026-11-02",
        accountId: b.current.id,
        subCategoryId: b.bakery.id,
        amount: 1n,
        plannedAmount: 1n,
        exchangeRate: "1",
        bookAmount: 1n,
      }),
    );
    await expect(insert).rejects.toThrow();
  });

  it("refuses an entry pointing to another book's items, even bypassing the API", async () => {
    const b = await bookWithReference();
    const other = await bookWithReference(b.owner);
    const insert = withUser(h.db, b.owner.id, (tx) =>
      tx.insert(journalEntry).values({
        bookId: b.bookId,
        date: "2026-11-02",
        accountId: other.current.id,
        subCategoryId: b.bakery.id,
        amount: 1n,
        plannedAmount: 1n,
        exchangeRate: "1",
        bookAmount: 1n,
      }),
    );
    await expect(insert).rejects.toThrow();
  });
});

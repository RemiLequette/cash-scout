import { afterAll, describe, expect, it } from "vitest";
import { createHarness, household, defaultNature } from "../test/harness.js";

const h = createHarness();
afterAll(() => h.sql.end());

interface Entry {
  id: string;
  date: string;
  accountId: string;
  subCategoryId: string;
  description: string;
  amount: string;
  plannedAmount: string;
  bookAmount: string;
  exchangeRate: string;
  reconciled: boolean;
  version: number;
  transferId: string | null;
  transferLeg: "source" | "destination" | null;
}
interface Transfer {
  id: string;
  version: number;
  delayDays: number;
  source: Entry;
  destination: Entry;
}

async function json<T>(response: Response | Promise<Response>, status = 200): Promise<T> {
  const res = await response;
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}

/** A EUR book with two EUR accounts and a MYR one, a transfer category and a food one. */
async function bookWithAccounts() {
  const owner = await h.signedInUser();
  const { id: bookId } = await json<{ id: string }>(
    owner.request("POST", "/books", household),
    201,
  );
  const post = <T>(path: string, body: unknown) =>
    json<T & { id: string }>(owner.request("POST", `/books/${bookId}/reference${path}`, body), 201);
  const group = await post("/groups", { names: { fr: "Vie courante" } });
  const transfers = await post("/categories", {
    groupId: group.id,
    code: "V01",
    natureId: await defaultNature(owner, bookId, "transfer"),
    names: { fr: "Virements" },
  });
  const food = await post("/categories", {
    groupId: group.id,
    code: "C01",
    natureId: await defaultNature(owner, bookId, "expense"),
    names: { fr: "Alimentation" },
  });
  const internal = await post("/sub-categories", {
    categoryId: transfers.id,
    names: { fr: "Entre comptes" },
  });
  const bakery = await post("/sub-categories", { categoryId: food.id, names: { fr: "Pain" } });
  const account = (name: string, currency: string) =>
    post("/accounts", { names: { fr: name }, kind: "bank", currency });
  const current = await account("Courant", "EUR");
  const savings = await account("Livret", "EUR");
  const ringgit = await account("Compte MYR", "MYR");

  const base = `/books/${bookId}/transfers`;
  const create = (body: Record<string, unknown>, status = 201) =>
    json<Transfer>(
      owner.request("POST", base, {
        date: "2026-11-02",
        delayDays: 2,
        sourceAccountId: current.id,
        destinationAccountId: savings.id,
        subCategoryId: internal.id,
        amount: "300",
        ...body,
      }),
      status,
    );
  const entries = () =>
    json<{ entries: Entry[] }>(owner.request("GET", `/books/${bookId}/journal`)).then(
      (r) => r.entries,
    );
  return { owner, bookId, base, create, entries, current, savings, ringgit, internal, bakery };
}

describe("transfers", () => {
  it("creates both sides, the destination a delay later, with opposite amounts", async () => {
    const b = await bookWithAccounts();
    const t = await b.create({ description: "Épargne" });
    expect(t.delayDays).toBe(2);
    expect(t.source).toMatchObject({
      date: "2026-11-02",
      accountId: b.current.id,
      amount: "-300.00",
      bookAmount: "-300.00",
      transferLeg: "source",
      transferId: t.id,
      plannedAmount: "0.00",
      description: "Épargne",
    });
    expect(t.destination).toMatchObject({
      date: "2026-11-04",
      accountId: b.savings.id,
      amount: "300.00",
      bookAmount: "300.00",
      transferLeg: "destination",
    });
    // Both sides are in the journal.
    expect(await b.entries()).toHaveLength(2);
  });

  it("plans both sides, their planned amounts adding up to zero", async () => {
    const b = await bookWithAccounts();
    const t = await b.create({ planned: true });
    expect(t.source.plannedAmount).toBe("-300.00");
    expect(t.destination.plannedAmount).toBe("300.00");
  });

  it("moves the planned amounts of both sides when changed in the budget's plan", async () => {
    const b = await bookWithAccounts();
    const t = await b.create({ planned: true });
    const replanned = await json<Transfer>(
      b.owner.request("PATCH", `${b.base}/${t.id}`, { amount: "450", planned: true }),
    );
    expect(replanned.source).toMatchObject({ amount: "-450.00", plannedAmount: "-450.00" });
    expect(replanned.destination).toMatchObject({ amount: "450.00", plannedAmount: "450.00" });
    await json(
      b.owner.request("POST", `/books/${b.bookId}/journal/reconcile`, {
        ids: [t.source.id],
        reconciled: true,
      }),
    );
    const refused = await b.owner.request("PATCH", `${b.base}/${t.id}`, {
      amount: "500",
      planned: true,
    });
    expect(refused.status).toBe(400);
  });

  it("needs a transfer sub-category and two different accounts", async () => {
    const b = await bookWithAccounts();
    await b.create({ subCategoryId: b.bakery.id }, 400);
    await b.create({ destinationAccountId: b.current.id }, 400);
    await b.create({ amount: "-5" }, 400);
  });

  it("changing one side changes the other: amount, date, delay, label", async () => {
    const b = await bookWithAccounts();
    const t = await b.create({});
    const changed = await json<Transfer>(
      b.owner.request("PATCH", `${b.base}/${t.id}`, {
        amount: "450",
        date: "2026-11-30",
        delayDays: 3,
        description: "Plus gros",
        version: t.version,
      }),
    );
    expect(changed.version).toBe(t.version + 1);
    expect(changed.source).toMatchObject({
      amount: "-450.00",
      date: "2026-11-30",
      description: "Plus gros",
    });
    expect(changed.destination).toMatchObject({
      amount: "450.00",
      date: "2026-12-03",
      description: "Plus gros",
    });
    // The planned amount never changes.
    expect(changed.source.plannedAmount).toBe("0.00");
  });

  it("changing only the delay moves only the destination", async () => {
    const b = await bookWithAccounts();
    const t = await b.create({});
    const changed = await json<Transfer>(
      b.owner.request("PATCH", `${b.base}/${t.id}`, { delayDays: 0 }),
    );
    expect(changed.source.date).toBe("2026-11-02");
    expect(changed.destination.date).toBe("2026-11-02");
  });

  it("reconciles each side on its own and keeps that when the transfer changes", async () => {
    const b = await bookWithAccounts();
    const t = await b.create({});
    await json(
      b.owner.request("POST", `/books/${b.bookId}/journal/reconcile`, {
        ids: [t.source.id],
        reconciled: true,
      }),
    );
    const changed = await json<Transfer>(
      b.owner.request("PATCH", `${b.base}/${t.id}`, { amount: "310" }),
    );
    expect(changed.source.reconciled).toBe(true);
    expect(changed.destination.reconciled).toBe(false);
  });

  it("refuses to change or delete a side through the journal, except its reconciling", async () => {
    const b = await bookWithAccounts();
    const t = await b.create({});
    const entry = `/books/${b.bookId}/journal/${t.source.id}`;
    expect((await b.owner.request("PATCH", entry, { amount: "-1" })).status).toBe(400);
    expect((await b.owner.request("DELETE", entry)).status).toBe(400);
    const ok = await b.owner.request("PATCH", entry, { reconciled: true });
    expect(ok.status).toBe(200);
  });

  it("deletes both sides together", async () => {
    const b = await bookWithAccounts();
    const t = await b.create({});
    expect((await b.owner.request("DELETE", `${b.base}/${t.id}`)).status).toBe(204);
    expect(await b.entries()).toHaveLength(0);
    expect((await b.owner.request("GET", `${b.base}/${t.id}`)).status).toBe(404);
  });

  it("answers 409 when the transfer moved on since it was read", async () => {
    const b = await bookWithAccounts();
    const t = await b.create({});
    await b.owner.request("PATCH", `${b.base}/${t.id}`, { amount: "1" });
    const stale = await b.owner.request("PATCH", `${b.base}/${t.id}`, {
      amount: "2",
      version: t.version,
    });
    expect(stale.status).toBe(409);
  });

  it("keeps both amounts between currencies, and requires the rates", async () => {
    const b = await bookWithAccounts();
    await b.create({ destinationAccountId: b.ringgit.id }, 400);
    await b.create({ destinationAccountId: b.ringgit.id, destinationAmount: "1500" }, 400);
    const t = await b.create({
      destinationAccountId: b.ringgit.id,
      destinationAmount: "1500",
      destinationRate: "0.2",
    });
    expect(t.source.amount).toBe("-300.00");
    expect(t.destination).toMatchObject({
      amount: "1500.00",
      exchangeRate: "0.2",
      bookAmount: "300.00",
    });
    const changed = await json<Transfer>(
      b.owner.request("PATCH", `${b.base}/${t.id}`, { destinationAmount: "1600" }),
    );
    expect(changed.destination).toMatchObject({ amount: "1600.00", bookAmount: "320.00" });
  });

  it("suggests the sub-category most used by the book's transfers", async () => {
    const b = await bookWithAccounts();
    const defaults = () =>
      json<{ subCategoryId: string | null; paymentTypeId: string | null }>(
        b.owner.request("GET", `${b.base}/defaults`),
      );
    expect(await defaults()).toEqual({ subCategoryId: null, paymentTypeId: null });
    await b.create({});
    await b.create({});
    expect((await defaults()).subCategoryId).toBe(b.internal.id);
  });

  it("lists the transfers leaving their account in a year, both sides together", async () => {
    const b = await bookWithAccounts();
    const late = await b.create({ date: "2025-12-31" }); // arrives in 2026
    const first = await b.create({ date: "2026-12-31" }); // arrives in 2027
    const year = (y: number) => json<Transfer[]>(b.owner.request("GET", `${b.base}?year=${y}`));

    expect((await year(2025)).map((t) => t.id)).toEqual([late.id]);
    expect(await year(2026)).toEqual([first]);
    expect(await year(2027)).toEqual([]);
  });

  it("saves the planned transfers together, or nothing", async () => {
    const b = await bookWithAccounts();
    const plan = (body: Record<string, unknown>) => b.owner.request("POST", `${b.base}/plan`, body);
    const year = () => json<Transfer[]>(b.owner.request("GET", `${b.base}?year=2026`));
    const input = (date: string) => ({
      date,
      sourceAccountId: b.current.id,
      destinationAccountId: b.savings.id,
      subCategoryId: b.internal.id,
      amount: "100",
    });

    expect((await plan({ create: [input("2026-01-05"), input("2026-02-05")] })).status).toBe(204);
    const [first, second] = await year();
    expect(first!.source.plannedAmount).toBe("-100.00");
    expect(first!.destination.plannedAmount).toBe("100.00");

    const change = {
      create: [input("2026-03-05")],
      update: [{ id: first!.id, version: first!.version, amount: "120", planned: true }],
      remove: [{ id: second!.id, version: second!.version + 1 }], // moved on
    };
    expect((await plan(change)).status).toBe(409);
    expect((await year()).map((t) => t.source.amount)).toEqual(["-100.00", "-100.00"]);

    change.remove = [{ id: second!.id, version: second!.version }];
    expect((await plan(change)).status).toBe(204);
    expect((await year()).map((t) => [t.source.date, t.destination.plannedAmount])).toEqual([
      ["2026-01-05", "120.00"],
      ["2026-03-05", "100.00"],
    ]);
  });

  it("does not remove a reconciled transfer from the plan", async () => {
    const b = await bookWithAccounts();
    const t = await b.create({ planned: true });
    await json(
      b.owner.request("POST", `/books/${b.bookId}/journal/reconcile`, {
        ids: [t.destination.id],
        reconciled: true,
      }),
    );
    const refused = await b.owner.request("POST", `${b.base}/plan`, {
      remove: [{ id: t.id, version: t.version }],
    });
    expect(refused.status).toBe(400);
    expect(await b.entries()).toHaveLength(2);
  });

  it("is private to the members of the book", async () => {
    const b = await bookWithAccounts();
    const t = await b.create({});
    const stranger = await h.signedInUser();
    expect((await stranger.request("GET", `${b.base}?year=2026`)).status).toBe(404);
    expect((await stranger.request("POST", `${b.base}/plan`, {})).status).toBe(404);
    expect((await stranger.request("GET", `${b.base}/${t.id}`)).status).toBe(404);
    expect((await stranger.request("DELETE", `${b.base}/${t.id}`)).status).toBe(404);
  });
});

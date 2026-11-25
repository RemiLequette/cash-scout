import { afterAll, describe, expect, it } from "vitest";
import { createHarness, defaultNature, household } from "../test/harness.js";

const h = createHarness();
afterAll(() => h.sql.end());

async function json<T>(response: Response | Promise<Response>, status = 200): Promise<T> {
  const res = await response;
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}

interface Account {
  id: string;
  version: number;
  openingBalance: string;
}

/** A EUR book with a EUR and a MYR account and one sub-category. */
async function bookWithAccounts() {
  const owner = await h.signedInUser();
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
    natureId: await defaultNature(owner, bookId, "expense"),
    names: { fr: "Alimentation" },
  });
  const bakery = await post("/sub-categories", { categoryId: food.id, names: { fr: "Pain" } });
  const current = await post<Account>("/accounts", {
    names: { fr: "Compte courant" },
    kind: "bank",
    currency: "EUR",
  });
  const ringgit = await post<Account>("/accounts", {
    names: { fr: "Compte MYR" },
    kind: "bank",
    currency: "MYR",
  });
  const add = (accountId: string, body: Record<string, unknown>) =>
    json(
      owner.request("POST", `/books/${bookId}/journal`, {
        date: "2026-11-02",
        accountId,
        subCategoryId: bakery.id,
        amount: "-10",
        ...body,
      }),
      201,
    );
  const setOpening = <T = Account>(accountId: string, body: unknown, status = 200) =>
    json<T>(owner.request("POST", ref(`/accounts/${accountId}/opening`), body), status);
  const balances = () =>
    json<{ accountId: string; reconciled: string; total: string }[]>(
      owner.request("GET", `/books/${bookId}/journal/balances`),
    );
  return { owner, bookId, ref, current, ringgit, add, setOpening, balances };
}

describe("opening balance", () => {
  it("starts at zero and shows in the account", async () => {
    const b = await bookWithAccounts();
    expect(b.current.openingBalance).toBe("0.00");
  });

  it("is set from a bank balance so that the reconciled entries add up to it", async () => {
    const b = await bookWithAccounts();
    await b.add(b.current.id, { amount: "-30", reconciled: true });
    await b.add(b.current.id, { amount: "-5", reconciled: false });
    const account = await b.setOpening(b.current.id, { balance: "1000" });
    expect(account.openingBalance).toBe("1030.00");
    const balance = (await b.balances()).find((x) => x.accountId === b.current.id)!;
    // The reconciled balance is the bank's; the total adds the forecast.
    expect(balance).toMatchObject({ reconciled: "1000.00", total: "995.00" });
  });

  it("counts every reconciled entry without a day, even a later one", async () => {
    const b = await bookWithAccounts();
    await b.add(b.current.id, { date: "2026-10-01", amount: "-30", reconciled: true });
    await b.add(b.current.id, { date: "2027-03-01", amount: "-20", reconciled: true });
    expect((await b.setOpening(b.current.id, { balance: "100" })).openingBalance).toBe("150.00");
  });

  it("counts only the reconciled entries up to a day when given one", async () => {
    const b = await bookWithAccounts();
    await b.add(b.current.id, { date: "2026-10-01", amount: "-30", reconciled: true });
    await b.add(b.current.id, { date: "2026-10-30", amount: "-20", reconciled: true });
    await b.add(b.current.id, { date: "2026-11-05", amount: "-40", reconciled: true });
    const account = await b.setOpening(b.current.id, { balance: "100", upTo: "2026-10-30" });
    expect(account.openingBalance).toBe("150.00");
  });

  it("can be set to an amount", async () => {
    const b = await bookWithAccounts();
    await b.add(b.current.id, { amount: "-30", reconciled: true });
    expect((await b.setOpening(b.current.id, { opening: "-12.50" })).openingBalance).toBe("-12.50");
    const balance = (await b.balances()).find((x) => x.accountId === b.current.id)!;
    expect(balance.reconciled).toBe("-42.50");
  });

  it("needs a rate for an account not in the book currency", async () => {
    const b = await bookWithAccounts();
    await b.setOpening(b.ringgit.id, { opening: "100" }, 400);
    const account = await b.setOpening(b.ringgit.id, { opening: "100", exchangeRate: "0.2" });
    expect(account.openingBalance).toBe("100.00");
  });

  it("proposes the account's latest rate when none is given", async () => {
    const b = await bookWithAccounts();
    await b.add(b.ringgit.id, { amount: "-10", exchangeRate: "0.2" });
    expect((await b.setOpening(b.ringgit.id, { opening: "50" })).openingBalance).toBe("50.00");
  });

  it("is in the projection's opening balance", async () => {
    const b = await bookWithAccounts();
    await b.add(b.current.id, { date: "2026-10-01", amount: "-30", reconciled: true });
    await b.setOpening(b.current.id, { opening: "500" });
    const rows = await json<{ accountId: string; opening: string }[]>(
      b.owner.request(
        "GET",
        `/books/${b.bookId}/journal/projection?from=2026-11-01&to=2026-11-30&today=2026-11-15`,
      ),
    );
    // 500 of opening balance, then the entry of October before the window.
    expect(rows.find((r) => r.accountId === b.current.id)!.opening).toBe("470.00");
  });

  it("is in the dashboard balances and in no category", async () => {
    const b = await bookWithAccounts();
    await b.setOpening(b.current.id, { opening: "500" });
    await b.add(b.current.id, { date: "2026-03-10", amount: "-30" });
    const data = await json<{
      cells: unknown[];
      balances: { accountId: string; ends: string[] }[];
    }>(b.owner.request("GET", `/books/${b.bookId}/dashboard?year=2026&today=2026-12-01`));
    const ends = data.balances.find((x) => x.accountId === b.current.id)!.ends;
    expect(ends[0]).toBe("500.00");
    expect(ends[2]).toBe("470.00");
    expect(data.cells).toHaveLength(1);
  });

  it("refuses a stale version", async () => {
    const b = await bookWithAccounts();
    await b.setOpening(b.current.id, { opening: "10" });
    await b.setOpening(b.current.id, { opening: "20", version: b.current.version }, 409);
  });

  it("is refused to a reader", async () => {
    const b = await bookWithAccounts();
    const reader = await h.signedInUser();
    const res = await reader.request("POST", b.ref(`/accounts/${b.current.id}/opening`), {
      opening: "1",
    });
    expect([403, 404]).toContain(res.status);
  });
});

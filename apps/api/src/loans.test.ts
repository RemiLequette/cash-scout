import { afterAll, describe, expect, it } from "vitest";
import { createHarness, household, defaultNature, type DefaultNature } from "../test/harness.js";

const h = createHarness();
afterAll(() => h.sql.end());

interface Entry {
  id: string;
  version: number;
  date: string;
  subCategoryId: string;
  description: string;
  amount: string;
  plannedAmount: string;
  reconciled: boolean;
  loanId: string | null;
  splitId: string | null;
  splitRemainder: boolean;
}
interface Loan {
  id: string;
  version: number;
  remaining: string;
  amount: string;
  nextPayment: { date: string; total: string } | null;
  events: { id: string; version: number; kind: string; amount: string | null }[];
  check: { journal: string; schedule: string; gap: string; flagged: boolean } | null;
}
interface Line {
  date: string;
  kind: string;
  capital: string;
  total: string;
  remaining: string;
  journal: "planned" | "reconciled" | null;
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

/** A EUR book with an account and the sub-categories of a loan's parts. */
async function setup() {
  const owner = await h.signedInUser();
  const { id: bookId } = await json<{ id: string }>(
    owner.request("POST", "/books", household),
    201,
  );
  const url = (path: string) => `/books/${bookId}${path}`;
  const post = <T = unknown>(path: string, body: unknown, expected = 201) =>
    json<T & { id: string }>(owner.request("POST", url(path), body), expected);
  const group = await post("/reference/groups", { names: { fr: "Logement" } });
  const category = async (code: string, kind: DefaultNature, name: string) =>
    post("/reference/categories", {
      groupId: group.id,
      code,
      natureId: await defaultNature(owner, bookId, kind),
      names: { fr: name },
    });
  const saving = await category("E01", "saving", "Capital");
  const costs = await category("C01", "expense", "Crédit");
  const moves = await category("T01", "transfer", "Virements");
  const sub = (categoryId: string, name: string) =>
    post("/reference/sub-categories", { categoryId, names: { fr: name } });
  const capital = await sub(saving.id, "Capital remboursé");
  const interest = await sub(costs.id, "Intérêts");
  const insurance = await sub(costs.id, "Assurance");
  const penalty = await sub(costs.id, "Pénalités");
  const move = await sub(moves.id, "Virement interne");
  const account = await post("/reference/accounts", { names: { fr: "Courant" }, currency: "EUR" });

  const terms = (changes: Record<string, unknown> = {}) => ({
    name: "Maison",
    lender: "Banque",
    amount: "120000",
    rate: "3",
    term: 240,
    start: "2026-01-05",
    insuranceMode: "initial",
    insuranceRate: "0.36",
    accountId: account.id,
    capitalSubCategoryId: capital.id,
    interestSubCategoryId: interest.id,
    insuranceSubCategoryId: insurance.id,
    ...changes,
  });
  const create = (changes: Record<string, unknown> = {}, expected = 201) =>
    post<Loan>("/loans", terms(changes), expected);
  const loans = (date = "2026-12-31") =>
    json<Loan[]>(owner.request("GET", url(`/loans?date=${date}`)));
  const schedule = async (id: string) =>
    (await json<{ lines: Line[] }>(owner.request("GET", url(`/loans/${id}/schedule`)))).lines;
  const plan = (id: string, year = 2026) =>
    post<{ created: number; replaced: number; removed: number }>(
      `/loans/${id}/plan`,
      { year },
      200,
    );
  const journal = async () =>
    (await json<{ entries: Entry[] }>(owner.request("GET", url("/journal?limit=2000")))).entries;

  return {
    owner,
    bookId,
    url,
    post,
    account,
    capital,
    interest,
    insurance,
    penalty,
    move,
    terms,
    create,
    loans,
    schedule,
    plan,
    journal,
  };
}

describe("loans", () => {
  it("keeps the terms and computes the remaining capital at a date", async () => {
    const s = await setup();
    const created = await s.create();
    expect(created.amount).toBe("120000.00");
    expect(created).toMatchObject({ note: "" });
    const noted = await s.create({ note: "Contrat 123 / A. Martin" });
    expect(noted).toMatchObject({ note: "Contrat 123 / A. Martin" });

    const [before] = await s.loans("2025-12-31");
    expect(before!.remaining).toBe("120000.00");
    expect(before!.nextPayment).toEqual({ date: "2026-01-05", total: "701.52" });
    const [after] = await s.loans("2026-01-05");
    expect(after!.remaining).toBe("119634.48");
    expect(await s.schedule(created.id)).toHaveLength(240);
  });

  it("refuses an unknown or a transfer sub-category, and a missing insurance one", async () => {
    const s = await setup();
    await s.create({ capitalSubCategoryId: s.move.id }, 400);
    await s.create({ insuranceSubCategoryId: null }, 400);
    await s.create({ interestSubCategoryId: s.account.id }, 400);
    await s.create({ amount: "12.345" }, 400);
    expect(await s.loans()).toEqual([]);
  });

  it("is changed as a whole, from the version read", async () => {
    const s = await setup();
    const created = await s.create();
    const patch = (changes: Record<string, unknown>) =>
      s.owner.request("PATCH", s.url(`/loans/${created.id}`), s.terms(changes));
    const changed = await json<Loan>(patch({ amount: "100000", version: created.version }));
    expect(changed.amount).toBe("100000.00");
    await status(patch({ version: created.version }), 409);
  });

  it("changes the schedule with events, no drawdown past the amount", async () => {
    const s = await setup();
    const { id } = await s.create();
    const events = `/loans/${id}/events`;
    await s.post(events, { date: "2026-01-01", kind: "drawdown", amount: "130000" }, 400);
    const repaid = await s.post<Loan>(events, {
      date: "2026-03-10",
      kind: "buyback",
      note: "Rachat par la banque B",
    });
    expect(repaid.events).toHaveLength(1);
    expect(repaid.events[0]).toMatchObject({ note: "Rachat par la banque B" });
    expect((await s.loans())[0]!.remaining).toBe("0.00");
    const lines = await s.schedule(id);
    expect(lines.map((line) => line.kind)).toEqual(["payment", "payment", "payment", "buyback"]);

    const event = repaid.events[0]!;
    const url = s.url(`${events}/${event.id}`);
    await json(
      s.owner.request("PATCH", url, {
        date: "2026-03-10",
        kind: "repayment",
        amount: "1000",
        version: event.version,
      }),
    );
    expect((await s.schedule(id)).length).toBeGreaterThan(200);
    await status(s.owner.request("DELETE", url), 204);
    expect(await s.schedule(id)).toHaveLength(240);
  });

  it("plans a year's payments as splits, once", async () => {
    const s = await setup();
    const { id } = await s.create();
    expect(await s.plan(id)).toEqual({ created: 12, replaced: 0, removed: 0 });
    expect(await s.plan(id)).toEqual({ created: 0, replaced: 0, removed: 0 });

    const entries = await s.journal();
    expect(entries).toHaveLength(36);
    expect(entries.every((e) => e.loanId === id && e.splitId && !e.reconciled)).toBe(true);
    const january = entries.filter((e) => e.date === "2026-01-05");
    const part = (sub: string) => january.find((e) => e.subCategoryId === sub)!;
    expect(part(s.capital.id)).toMatchObject({
      amount: "-365.52",
      plannedAmount: "-365.52",
      description: "Maison",
      splitRemainder: false,
    });
    expect(part(s.interest.id)).toMatchObject({ amount: "-300.00", splitRemainder: true });
    expect(part(s.insurance.id)).toMatchObject({ amount: "-36.00", splitRemainder: false });
    expect((await s.schedule(id)).filter((line) => line.journal === "planned")).toHaveLength(12);
  });

  it("brings forecasts in line with the schedule, never what is reconciled", async () => {
    const s = await setup();
    const { id } = await s.create();
    await s.plan(id);
    const january = (await s.journal()).filter((e) => e.date === "2026-01-05");
    await status(
      s.owner.request("POST", s.url("/journal/reconcile"), {
        ids: january.map((e) => e.id),
        reconciled: true,
      }),
      200,
    );
    // A repayment in June, then the end of the loan in September.
    await s.post(`/loans/${id}/events`, { date: "2026-06-05", kind: "repayment", amount: "10000" });
    const first = await s.plan(id);
    // The interest changes from July; the repayment itself is a planned entry.
    expect(first).toEqual({ created: 1, replaced: 6, removed: 0 });
    const repayment = (await s.journal()).filter((e) => e.amount === "-10000.00");
    expect(repayment).toMatchObject([{ subCategoryId: s.capital.id, splitId: null, loanId: id }]);

    await s.post(`/loans/${id}/events`, { date: "2026-09-10", kind: "buyback" });
    expect(await s.plan(id)).toEqual({ created: 0, replaced: 0, removed: 3 });
    const left = await s.journal();
    expect(left.filter((e) => e.date === "2026-01-05").every((e) => e.reconciled)).toBe(true);
    expect(Math.max(...left.map((e) => Number(e.date.slice(5, 7))))).toBe(9);
  });

  it("plans an insurance paid apart as its own entry, on another account, and follows a change of insurer", async () => {
    const s = await setup();
    const other = await s.post<{ id: string }>("/reference/accounts", {
      names: { fr: "Assurance" },
      currency: "EUR",
    });
    const dollars = await s.post<{ id: string }>("/reference/accounts", {
      names: { fr: "Dollars" },
      currency: "USD",
    });
    await s.create({ insuranceSeparate: true, insuranceAccountId: dollars.id }, 400);
    const { id } = await s.create({ insuranceSeparate: true, insuranceAccountId: other.id });
    expect(await s.plan(id)).toEqual({ created: 24, replaced: 0, removed: 0 });
    expect(await s.plan(id)).toEqual({ created: 0, replaced: 0, removed: 0 });

    const entries = await s.journal();
    const insurance = entries.filter((e) => e.subCategoryId === s.insurance.id);
    expect(insurance).toHaveLength(12);
    expect(insurance.every((e) => e.splitId === null && e.amount === "-36.00")).toBe(true);
    expect(
      entries.filter((e) => e.date === "2026-01-05" && e.subCategoryId !== s.insurance.id),
    ).toHaveLength(2);
    const line = (await s.schedule(id))[0]!;
    expect(line).toMatchObject({
      total: "665.52",
      insuranceSeparate: true,
      insuranceJournal: "planned",
    });

    // From July, another insurer, whose cost is in the payment.
    await s.post(`/loans/${id}/events`, {
      date: "2026-07-01",
      kind: "insurance",
      insuranceMode: "remaining",
      insuranceRate: "0.20",
    });
    expect(await s.plan(id)).toEqual({ created: 0, replaced: 6, removed: 6 });
    const after = await s.journal();
    expect(after.filter((e) => e.subCategoryId === s.insurance.id)).toHaveLength(12);
    const july = after.filter((e) => e.date === "2026-07-05");
    expect(july).toHaveLength(3);
    expect(july.find((e) => e.subCategoryId === s.insurance.id)!.splitId).not.toBeNull();
  });

  it("plans the penalty of a buy-back as a cost of its own", async () => {
    const s = await setup();
    const without = await s.create();
    await s.post(
      `/loans/${without.id}/events`,
      { date: "2026-03-10", kind: "buyback", penalty: "1500" },
      400,
    );
    const { id } = await s.create({ penaltySubCategoryId: s.penalty.id });
    const events = `/loans/${id}/events`;
    await s.post(events, { date: "2026-03-10", kind: "drawdown", penalty: "5", amount: "1" }, 400);
    const bought = await s.post<Loan>(events, {
      date: "2026-03-10",
      kind: "buyback",
      penalty: "1500",
    });
    expect(await s.plan(id)).toEqual({ created: 4, replaced: 0, removed: 0 });
    expect(await s.plan(id)).toEqual({ created: 0, replaced: 0, removed: 0 });
    const fee = (await s.journal()).filter((e) => e.subCategoryId === s.penalty.id);
    expect(fee).toMatchObject([
      { amount: "-1500.00", date: "2026-03-10", splitId: null, loanId: id },
    ]);
    const line = (await s.schedule(id)).find((l) => l.kind === "buyback")!;
    expect(line).toMatchObject({ penalty: "1500.00", penaltyJournal: "planned" });

    const event = (bought.events as { id: string; version: number }[])[0]!;
    await json(
      s.owner.request("PATCH", s.url(`${events}/${event.id}`), {
        date: "2026-03-10",
        kind: "buyback",
        penalty: "2000",
        version: event.version,
      }),
    );
    expect(await s.plan(id)).toEqual({ created: 0, replaced: 1, removed: 0 });
    // The penalty goes with the event.
    await status(s.owner.request("DELETE", s.url(`${events}/${event.id}`)), 204);
    expect(await s.plan(id)).toEqual({ created: 9, replaced: 0, removed: 1 });
  });

  it("does not plan again a payment entered by hand", async () => {
    const s = await setup();
    const { id } = await s.create();
    await s.post("/journal", {
      date: "2026-02-07",
      accountId: s.account.id,
      subCategoryId: s.capital.id,
      amount: "-366.43",
    });
    expect((await s.plan(id)).created).toBe(11);
  });

  it("keeps two loans of one account apart", async () => {
    const s = await setup();
    const first = await s.create();
    const second = await s.create({ name: "Travaux", amount: "10000", term: 60 });
    expect((await s.plan(first.id)).created).toBe(12);
    expect((await s.plan(second.id)).created).toBe(12);
    expect((await s.plan(first.id)).created).toBe(0);
  });

  it("flags a gap between the capital repaid in the journal and the schedule", async () => {
    const s = await setup();
    const { id } = await s.create();
    expect((await s.loans())[0]!.check).toBeNull();
    await s.plan(id);
    const entries = await s.journal();
    const reconcile = (months: string[]) =>
      status(
        s.owner.request("POST", s.url("/journal/reconcile"), {
          ids: entries.filter((e) => months.includes(e.date.slice(5, 7))).map((e) => e.id),
          reconciled: true,
        }),
        200,
      );
    await reconcile(["01", "03"]);
    const gap = (await s.loans())[0]!.check!;
    expect(gap).toMatchObject({ flagged: true, gap: "-366.43" });
    await reconcile(["02"]);
    expect((await s.loans())[0]!.check).toMatchObject({ flagged: false, gap: "0.00" });
  });

  it("leaves the entries when deleted, and follows a merged sub-category", async () => {
    const s = await setup();
    const { id } = await s.create();
    await s.plan(id);
    // In use: neither the sub-category nor the account can be deleted.
    await status(
      s.owner.request("DELETE", s.url(`/reference/sub-categories/${s.insurance.id}`)),
      409,
    );
    await json(
      s.owner.request("POST", s.url(`/reference/sub-categories/${s.insurance.id}/merge`), {
        targetId: s.interest.id,
      }),
    );
    await status(s.owner.request("DELETE", s.url(`/loans/${id}`)), 204);
    expect(await s.loans()).toEqual([]);
    const entries = await s.journal();
    expect(entries).toHaveLength(36);
    expect(entries.every((e) => e.loanId === null)).toBe(true);
  });

  it("goes with the book's export and import", async () => {
    const s = await setup();
    const { id } = await s.create();
    await s.post(`/loans/${id}/events`, { date: "2027-01-10", kind: "repayment", amount: "500" });
    await s.plan(id);
    const file = await json(s.owner.request("GET", s.url("/export")));
    const copy = await json<{ id: string }>(s.owner.request("POST", "/books/import", file), 201);
    const [loan] = await json<Loan[]>(
      s.owner.request("GET", `/books/${copy.id}/loans?date=2026-12-31`),
    );
    expect(loan!.id).not.toBe(id);
    expect(loan!.events).toMatchObject([{ kind: "repayment", amount: "500.00" }]);
    const { entries } = await json<{ entries: Entry[] }>(
      s.owner.request("GET", `/books/${copy.id}/journal`),
    );
    expect(entries.every((e) => e.loanId === loan!.id)).toBe(true);
    await status(s.owner.request("DELETE", s.url("")), 204);
  });

  it("isolates books, and lets viewers only read", async () => {
    const s = await setup();
    const { id } = await s.create();
    const other = await setup();
    await status(other.owner.request("GET", s.url("/loans?date=2026-01-01")), 404);
    await status(other.owner.request("GET", other.url(`/loans/${id}/schedule`)), 404);
    await status(other.owner.request("DELETE", other.url(`/loans/${id}`)), 404);
    // Another book's account cannot be named.
    await other.create({ accountId: s.account.id }, 400);

    const viewer = await h.signedInUser();
    await s.post("/members", { email: viewer.email, role: "viewer" });
    await status(viewer.request("GET", s.url("/loans?date=2026-01-01")), 200);
    await status(viewer.request("POST", s.url("/loans"), s.terms()), 403);
    await status(viewer.request("POST", s.url(`/loans/${id}/plan`), { year: 2026 }), 403);

    // Row-level security, past the API.
    const rows = await h.sql`select id from loan`;
    expect(rows).toHaveLength(0);
  });
});

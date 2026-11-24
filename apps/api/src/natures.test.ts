import { afterAll, describe, expect, it } from "vitest";
import { createHarness, household } from "../test/harness.js";

const h = createHarness();
afterAll(() => h.sql.end());

async function json<T>(response: Response | Promise<Response>, status = 200): Promise<T> {
  const res = await response;
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}

interface Nature {
  id: string;
  version: number;
  names: Record<string, string>;
  sign: number;
  transfer: boolean;
  position: number;
  archived: boolean;
}
interface Balance {
  id: string;
  version: number;
  names: Record<string, string>;
  position: number;
  natureIds: string[];
  archived: boolean;
}
interface Reference {
  natures: Nature[];
  balances: Balance[];
  categories: { id: string; natureId: string }[];
}

async function setup() {
  const owner = await h.signedInUser();
  const { id: bookId } = await json<{ id: string }>(
    owner.request("POST", "/books", household),
    201,
  );
  const ref = (path = "") => `/books/${bookId}/reference${path}`;
  const read = () => json<Reference>(owner.request("GET", ref()));
  const post = <T>(path: string, body: unknown, status = 201) =>
    json<T>(owner.request("POST", ref(path), body), status);
  const group = await post<{ id: string }>("/groups", { names: { fr: "Courant" } });
  const category = (code: string, extra: object) =>
    post<{ id: string; natureId: string }>("/categories", {
      groupId: group.id,
      code,
      names: { fr: code },
      ...extra,
    });
  return { owner, bookId, ref, read, post, category };
}

describe("natures", () => {
  it("starts a book with four natures, named in its language", async () => {
    const { read } = await setup();
    const { natures } = await read();
    expect(natures.map((n) => [n.names.fr, n.sign, n.transfer, n.position])).toEqual([
      ["Revenus", 1, false, 0],
      ["Dépenses", -1, false, 1],
      ["Épargne", -1, false, 2],
      ["Virements", 1, true, 3],
    ]);
  });

  it("adds a nature at the end of the list", async () => {
    const { post, read } = await setup();
    const created = await post<Nature>("/natures", {
      names: { fr: "Exceptionnel" },
      sign: -1,
    });
    expect(created.position).toBe(4);
    expect((await read()).natures.at(-1)!.id).toBe(created.id);
  });

  it("refuses a name without the book's default language, and a sign other than 1 or -1", async () => {
    const { post } = await setup();
    await post("/natures", { names: { en: "Odd" }, sign: -1 }, 400);
    await post("/natures", { names: { fr: "Odd" }, sign: 2 }, 400);
  });

  it("gives a category the nature asked for", async () => {
    const { post, category } = await setup();
    const once = await post<Nature>("/natures", {
      names: { fr: "Exceptionnel" },
      sign: -1,
    });
    const roof = await category("E01", { natureId: once.id });
    expect(roof.natureId).toBe(once.id);
  });

  it("needs a known, active nature to make or move a category", async () => {
    const { owner, ref, post, read, category } = await setup();
    const [income] = (await read()).natures;
    const base = await category("C01", { natureId: income!.id });
    const { groups } = await json<{ groups: { id: string }[] }>(owner.request("GET", ref()));
    const body = { groupId: groups[0]!.id, code: "C02", names: { fr: "C02" } };
    await post("/categories", body, 400);
    await post("/categories", { ...body, natureId: crypto.randomUUID() }, 400);
    const once = await post<Nature>("/natures", { names: { fr: "Exceptionnel" }, sign: -1 });
    await json(
      owner.request("PATCH", ref(`/natures/${once.id}`), { archived: true, version: once.version }),
    );
    await post("/categories", { ...body, natureId: once.id }, 400);
    const moved = await owner.request("PATCH", ref(`/categories/${base.id}`), {
      natureId: once.id,
    });
    expect(moved.status).toBe(400);
  });

  it("moves a category to another nature", async () => {
    const { owner, ref, post, category } = await setup();
    const once = await post<Nature>("/natures", { names: { fr: "Exceptionnel" }, sign: -1 });
    const other = await post<Nature>("/natures", { names: { fr: "Autre" }, sign: 1 });
    const roof = await category("E01", { natureId: once.id });
    const moved = await json<{ natureId: string }>(
      owner.request("PATCH", ref(`/categories/${roof.id}`), { natureId: other.id }),
    );
    expect(moved.natureId).toBe(other.id);
  });

  it("keeps the nature of a category that is renamed", async () => {
    const { owner, ref, post, category } = await setup();
    const once = await post<Nature>("/natures", { names: { fr: "Exceptionnel" }, sign: -1 });
    const roof = await category("E01", { natureId: once.id });
    const renamed = await json<{ natureId: string }>(
      owner.request("PATCH", ref(`/categories/${roof.id}`), { names: { fr: "Toit" } }),
    );
    expect(renamed.natureId).toBe(once.id);
  });

  it("marks a nature as holding transfers", async () => {
    const { owner, ref, post } = await setup();
    const own = await post<Nature>("/natures", {
      names: { fr: "Entre comptes" },
      sign: 1,
      transfer: true,
    });
    expect(own.transfer).toBe(true);
    const back = await json<Nature>(
      owner.request("PATCH", ref(`/natures/${own.id}`), { transfer: false, version: own.version }),
    );
    expect(back.transfer).toBe(false);
  });

  it("refuses to delete a nature that categories use, and deletes an unused one", async () => {
    const { owner, ref, post, category } = await setup();
    const once = await post<Nature>("/natures", {
      names: { fr: "Exceptionnel" },
      sign: -1,
    });
    await category("E01", { natureId: once.id });
    expect((await owner.request("DELETE", ref(`/natures/${once.id}`))).status).toBe(409);
    const spare = await post<Nature>("/natures", {
      names: { fr: "Libre" },
      sign: -1,
    });
    expect((await owner.request("DELETE", ref(`/natures/${spare.id}`))).status).toBe(204);
  });
});

describe("balances", () => {
  async function withNatures() {
    const b = await setup();
    const { natures } = await b.read();
    const by = (name: string) => natures.find((n) => n.names.fr === name)!;
    return { ...b, income: by("Revenus"), spending: by("Dépenses"), saving: by("Épargne") };
  }

  it("adds up the natures it is given", async () => {
    const { post, read, income, spending } = await withNatures();
    const current = await post<Balance>("/balances", {
      names: { fr: "Solde courant" },
      natureIds: [income.id, spending.id],
    });
    expect(current.position).toBe(4);
    const { balances } = await read();
    expect(balances).toHaveLength(1);
    expect(balances[0]!.natureIds.sort()).toEqual([income.id, spending.id].sort());
  });

  it("refuses an empty or unknown list of natures", async () => {
    const { post } = await withNatures();
    await post("/balances", { names: { fr: "Vide" }, natureIds: [] }, 400);
    await post("/balances", { names: { fr: "Inconnu" }, natureIds: [crypto.randomUUID()] }, 400);
  });

  it("changes its natures, and bumps its version when only they change", async () => {
    const { owner, ref, post, read, income, spending, saving } = await withNatures();
    const current = await post<Balance>("/balances", {
      names: { fr: "Solde courant" },
      natureIds: [income.id, spending.id],
    });
    const updated = await json<Balance>(
      owner.request("PATCH", ref(`/balances/${current.id}`), {
        natureIds: [income.id, saving.id],
        version: current.version,
      }),
    );
    expect(updated.version).toBe(current.version + 1);
    expect(updated.natureIds.sort()).toEqual([income.id, saving.id].sort());
    expect((await read()).balances[0]!.natureIds.sort()).toEqual([income.id, saving.id].sort());
    const stale = await owner.request("PATCH", ref(`/balances/${current.id}`), {
      names: { fr: "Autre" },
      version: current.version,
    });
    expect(stale.status).toBe(409);
  });

  it("keeps a nature that a balance uses, and lets the balance go", async () => {
    const { owner, ref, post, income } = await withNatures();
    const balance = await post<Balance>("/balances", {
      names: { fr: "Solde" },
      natureIds: [income.id],
    });
    expect((await owner.request("DELETE", ref(`/natures/${income.id}`))).status).toBe(409);
    expect((await owner.request("DELETE", ref(`/balances/${balance.id}`))).status).toBe(204);
  });
});

describe("the list of natures and balances", () => {
  it("reorders natures and balances as one list", async () => {
    const { post, read, owner, ref } = await setup();
    const { natures } = await read();
    const [income, spending, saving] = natures;
    const balance = await post<Balance>("/balances", {
      names: { fr: "Courant" },
      natureIds: [income!.id, spending!.id],
    });
    const order = [
      { kind: "nature", id: income!.id },
      { kind: "nature", id: spending!.id },
      { kind: "balance", id: balance.id },
      { kind: "nature", id: saving!.id },
    ];
    expect((await owner.request("POST", ref("/lines/reorder"), { items: order })).status).toBe(204);
    const after = await read();
    expect(after.balances[0]!.position).toBe(2);
    expect(after.natures.find((n) => n.id === saving!.id)!.position).toBe(3);
  });

  it("refuses an unknown line and a line given twice", async () => {
    const { read, owner, ref } = await setup();
    const [income] = (await read()).natures;
    const unknown = await owner.request("POST", ref("/lines/reorder"), {
      items: [{ kind: "balance", id: income!.id }],
    });
    expect(unknown.status).toBe(400);
    const twice = await owner.request("POST", ref("/lines/reorder"), {
      items: [
        { kind: "nature", id: income!.id },
        { kind: "nature", id: income!.id },
      ],
    });
    expect(twice.status).toBe(400);
  });

  it("is read-only for a viewer and invisible to a stranger", async () => {
    const { owner, bookId, ref, read } = await setup();
    const [income] = (await read()).natures;
    const viewer = await h.signedInUser();
    await owner.request("POST", `/books/${bookId}/members`, {
      email: viewer.email,
      role: "viewer",
    });
    const items = [{ kind: "nature", id: income!.id }];
    expect((await viewer.request("POST", ref("/lines/reorder"), { items })).status).toBe(403);
    const stranger = await h.signedInUser();
    expect((await stranger.request("POST", ref("/lines/reorder"), { items })).status).toBe(404);
    expect(
      (
        await viewer.request("POST", ref("/natures"), {
          names: { fr: "X" },
          sign: -1,
        })
      ).status,
    ).toBe(403);
  });
});

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
  behavior: string;
  sign: number;
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
  categories: { id: string; natureId: string; direction: string }[];
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
    post<{ id: string; natureId: string; direction: string }>("/categories", {
      groupId: group.id,
      code,
      names: { fr: code },
      ...extra,
    });
  return { owner, bookId, ref, read, post, category };
}

describe("natures", () => {
  it("starts a book with one nature per direction, named in its language", async () => {
    const { read } = await setup();
    const { natures } = await read();
    expect(natures.map((n) => [n.names.fr, n.behavior, n.sign, n.position])).toEqual([
      ["Revenus", "income", 1, 0],
      ["Dépenses", "expense", -1, 1],
      ["Épargne", "saving", -1, 2],
      ["Virements", "transfer", 1, 3],
    ]);
  });

  it("adds a nature at the end of the list", async () => {
    const { post, read } = await setup();
    const created = await post<Nature>("/natures", {
      names: { fr: "Exceptionnel" },
      behavior: "expense",
      sign: -1,
    });
    expect(created.position).toBe(4);
    expect((await read()).natures.at(-1)!.id).toBe(created.id);
  });

  it("refuses a name without the book's default language, and a sign other than 1 or -1", async () => {
    const { post } = await setup();
    await post("/natures", { names: { en: "Odd" }, behavior: "expense", sign: -1 }, 400);
    await post("/natures", { names: { fr: "Odd" }, behavior: "expense", sign: 2 }, 400);
  });

  it("gives a category the nature asked for, with that nature's behaviour", async () => {
    const { post, category } = await setup();
    const once = await post<Nature>("/natures", {
      names: { fr: "Exceptionnel" },
      behavior: "expense",
      sign: -1,
    });
    const roof = await category("E01", { natureId: once.id });
    expect(roof).toMatchObject({ natureId: once.id, direction: "expense" });
  });

  it("gives a category the first nature of a direction when only the direction is given", async () => {
    const { read, post, category } = await setup();
    await post("/natures", { names: { fr: "Exceptionnel" }, behavior: "expense", sign: -1 });
    const food = await category("C01", { direction: "expense" });
    const { natures } = await read();
    expect(food.natureId).toBe(natures.find((n) => n.names.fr === "Dépenses")!.id);
    await post("/categories", { groupId: food.id, code: "X", names: { fr: "X" } }, 400);
  });

  it("refuses an unknown or archived nature", async () => {
    const { owner, ref, post, category } = await setup();
    await post(
      "/categories",
      {
        groupId: crypto.randomUUID(),
        code: "Z1",
        names: { fr: "Z" },
        natureId: crypto.randomUUID(),
      },
      400,
    );
    const once = await post<Nature>("/natures", {
      names: { fr: "Exceptionnel" },
      behavior: "expense",
      sign: -1,
    });
    await json(
      owner.request("PATCH", ref(`/natures/${once.id}`), { archived: true, version: once.version }),
    );
    const refused = await owner.request("POST", ref("/categories"), {
      groupId: (await category("C01", { direction: "expense" })).id,
      code: "E02",
      names: { fr: "E02" },
      natureId: once.id,
    });
    expect(refused.status).toBe(400);
  });

  it("moves a category to another nature, and keeps its nature when only the same direction is sent", async () => {
    const { owner, ref, post, category } = await setup();
    const once = await post<Nature>("/natures", {
      names: { fr: "Exceptionnel" },
      behavior: "expense",
      sign: -1,
    });
    const roof = await category("E01", { natureId: once.id });
    const same = await json<{ natureId: string }>(
      owner.request("PATCH", ref(`/categories/${roof.id}`), { direction: "expense" }),
    );
    expect(same.natureId).toBe(once.id);
    const income = await json<{ natureId: string; direction: string }>(
      owner.request("PATCH", ref(`/categories/${roof.id}`), { direction: "income" }),
    );
    expect(income.direction).toBe("income");
    expect(income.natureId).not.toBe(once.id);
  });

  it("changes the behaviour of the categories when a nature changes its own", async () => {
    const { owner, ref, post, read, category } = await setup();
    const once = await post<Nature>("/natures", {
      names: { fr: "Exceptionnel" },
      behavior: "expense",
      sign: -1,
    });
    const roof = await category("E01", { natureId: once.id });
    await json(
      owner.request("PATCH", ref(`/natures/${once.id}`), {
        behavior: "saving",
        version: once.version,
      }),
    );
    expect((await read()).categories.find((c) => c.id === roof.id)!.direction).toBe("saving");
  });

  it("refuses to delete a nature that categories use, and deletes an unused one", async () => {
    const { owner, ref, post, category } = await setup();
    const once = await post<Nature>("/natures", {
      names: { fr: "Exceptionnel" },
      behavior: "expense",
      sign: -1,
    });
    await category("E01", { natureId: once.id });
    expect((await owner.request("DELETE", ref(`/natures/${once.id}`))).status).toBe(409);
    const spare = await post<Nature>("/natures", {
      names: { fr: "Libre" },
      behavior: "expense",
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
          behavior: "expense",
          sign: -1,
        })
      ).status,
    ).toBe(403);
  });
});

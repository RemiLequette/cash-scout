import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createHarness, household } from "../test/harness.js";
import { withUser } from "./db/client.js";
import { category } from "./db/schema.js";

const h = createHarness();
afterAll(() => h.sql.end());

type User = Awaited<ReturnType<typeof h.signedInUser>>;

/** A book in French and English, owned by a new user. */
async function bilingualBook() {
  const owner = await h.signedInUser();
  const created = await owner.request("POST", "/books", household);
  const { id } = (await created.json()) as { id: string };
  const updated = await owner.request("PATCH", `/books/${id}`, {
    name: household.name,
    defaultLanguage: "fr",
    languages: ["fr", "en"],
  });
  expect(updated.status).toBe(200);
  return { owner, bookId: id, ref: (path = "") => `/books/${id}/reference${path}` };
}

async function json<T>(response: Response | Promise<Response>, status = 200): Promise<T> {
  const res = await response;
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}

async function categoryTree(owner: User, ref: (path?: string) => string) {
  const group = await json<{ id: string }>(
    owner.request("POST", ref("/groups"), { names: { fr: "Vie courante", en: "Daily life" } }),
    201,
  );
  const food = await json<{ id: string }>(
    owner.request("POST", ref("/categories"), {
      groupId: group.id,
      code: "C01",
      direction: "expense",
      names: { fr: "Alimentation", en: "Food" },
    }),
    201,
  );
  const bakery = await json<{ id: string }>(
    owner.request("POST", ref("/sub-categories"), {
      categoryId: food.id,
      names: { fr: "Boulangerie" },
    }),
    201,
  );
  return { group, food, bakery };
}

describe("book languages", () => {
  it("lists the languages, default first", async () => {
    const { owner, bookId } = await bilingualBook();
    const book = await json<{ languages: string[] }>(owner.request("GET", `/books/${bookId}`));
    expect(book.languages).toEqual(["fr", "en"]);
  });

  it("rejects a default language outside the list", async () => {
    const { owner, bookId } = await bilingualBook();
    const response = await owner.request("PATCH", `/books/${bookId}`, {
      name: "x",
      defaultLanguage: "de",
      languages: ["fr"],
    });
    expect(response.status).toBe(400);
  });
});

describe("categories", () => {
  it("builds the group → category → sub-category tree", async () => {
    const { owner, ref } = await bilingualBook();
    const { group, food, bakery } = await categoryTree(owner, ref);

    const reference = await json<{
      groups: { id: string }[];
      categories: { id: string; groupId: string; direction: string; names: object }[];
      subCategories: { id: string; categoryId: string }[];
    }>(owner.request("GET", ref()));
    expect(reference.groups.map((g) => g.id)).toEqual([group.id]);
    expect(reference.categories).toEqual([
      expect.objectContaining({
        id: food.id,
        groupId: group.id,
        direction: "expense",
        names: { fr: "Alimentation", en: "Food" },
      }),
    ]);
    expect(reference.subCategories).toEqual([
      expect.objectContaining({ id: bakery.id, categoryId: food.id }),
    ]);
  });

  it("checks names against the book languages", async () => {
    const { owner, ref } = await bilingualBook();
    const missingDefault = await owner.request("POST", ref("/groups"), { names: { en: "Daily" } });
    expect(missingDefault.status).toBe(400);
    const unknownLanguage = await owner.request("POST", ref("/groups"), {
      names: { fr: "Vie", de: "Leben" },
    });
    expect(unknownLanguage.status).toBe(400);
  });

  it("keeps codes unique in a book", async () => {
    const { owner, ref } = await bilingualBook();
    const { group } = await categoryTree(owner, ref);
    const duplicate = await owner.request("POST", ref("/categories"), {
      groupId: group.id,
      code: "C01",
      direction: "income",
      names: { fr: "Salaire" },
    });
    expect(duplicate.status).toBe(409);
  });

  it("renames, moves and archives", async () => {
    const { owner, ref } = await bilingualBook();
    const { group, food, bakery } = await categoryTree(owner, ref);
    const other = await json<{ id: string }>(
      owner.request("POST", ref("/categories"), {
        groupId: group.id,
        code: "C02",
        direction: "expense",
        names: { fr: "Maison" },
      }),
      201,
    );

    const moved = await json<{ categoryId: string; names: object; archived: boolean }>(
      owner.request("PATCH", ref(`/sub-categories/${bakery.id}`), {
        categoryId: other.id,
        names: { fr: "Pain", en: "Bread" },
        archived: true,
      }),
    );
    expect(moved).toMatchObject({
      categoryId: other.id,
      names: { fr: "Pain", en: "Bread" },
      archived: true,
    });

    const recoded = await json<{ code: string }>(
      owner.request("PATCH", ref(`/categories/${food.id}`), { code: "C10" }),
    );
    expect(recoded.code).toBe("C10");
  });

  it("keeps names in a language the book no longer uses", async () => {
    const { owner, bookId, ref } = await bilingualBook();
    const { food } = await categoryTree(owner, ref);
    await owner.request("PATCH", `/books/${bookId}`, {
      name: household.name,
      defaultLanguage: "fr",
      languages: ["fr"],
    });
    const renamed = await json<{ names: object }>(
      owner.request("PATCH", ref(`/categories/${food.id}`), { names: { fr: "Nourriture" } }),
    );
    expect(renamed.names).toEqual({ fr: "Nourriture", en: "Food" });
  });

  it("refuses to move an item under another book's parent", async () => {
    const mine = await bilingualBook();
    const theirs = await bilingualBook();
    const { food } = await categoryTree(theirs.owner, theirs.ref);
    const { bakery } = await categoryTree(mine.owner, mine.ref);

    const response = await mine.owner.request("PATCH", mine.ref(`/sub-categories/${bakery.id}`), {
      categoryId: food.id,
    });
    expect(response.status).toBe(409);
  });

  it("deletes only unused items", async () => {
    const { owner, ref } = await bilingualBook();
    const { group, food, bakery } = await categoryTree(owner, ref);
    expect((await owner.request("DELETE", ref(`/groups/${group.id}`))).status).toBe(409);
    expect((await owner.request("DELETE", ref(`/sub-categories/${bakery.id}`))).status).toBe(204);
    expect((await owner.request("DELETE", ref(`/categories/${food.id}`))).status).toBe(204);
    expect((await owner.request("DELETE", ref(`/groups/${group.id}`))).status).toBe(204);
  });
});

describe("accounts and payment types", () => {
  it("stores the threshold in the account currency", async () => {
    const { owner, ref } = await bilingualBook();
    const account = await json<{ id: string; lowBalanceThreshold: string; kind: string }>(
      owner.request("POST", ref("/accounts"), {
        names: { fr: "Compte courant" },
        kind: "bank",
        currency: "EUR",
        lowBalanceThreshold: "-500",
      }),
      201,
    );
    expect(account).toMatchObject({ kind: "bank", lowBalanceThreshold: "-500.00" });

    const yen = await owner.request("POST", ref("/accounts"), {
      names: { fr: "Compte JPY" },
      kind: "bank",
      currency: "JPY",
      lowBalanceThreshold: "1.5",
    });
    expect(yen.status).toBe(400);

    const cleared = await json<{ lowBalanceThreshold: null }>(
      owner.request("PATCH", ref(`/accounts/${account.id}`), { lowBalanceThreshold: null }),
    );
    expect(cleared.lowBalanceThreshold).toBeNull();
  });

  it("creates virtual accounts and payment types", async () => {
    const { owner, ref } = await bilingualBook();
    await json(
      owner.request("POST", ref("/accounts"), {
        names: { fr: "Compensations" },
        kind: "virtual",
        currency: "EUR",
      }),
      201,
    );
    await json(owner.request("POST", ref("/payment-types"), { names: { fr: "Carte" } }), 201);
    const reference = await json<{ accounts: unknown[]; paymentTypes: unknown[] }>(
      owner.request("GET", ref()),
    );
    expect(reference.accounts).toHaveLength(1);
    expect(reference.paymentTypes).toHaveLength(1);
  });
});

describe("roles and isolation", () => {
  it("lets viewers read but not write", async () => {
    const { owner, bookId, ref } = await bilingualBook();
    const viewer = await h.signedInUser();
    await owner.request("POST", `/books/${bookId}/members`, {
      email: viewer.email,
      role: "viewer",
    });

    expect((await viewer.request("GET", ref())).status).toBe(200);
    const write = await viewer.request("POST", ref("/payment-types"), { names: { fr: "Carte" } });
    expect(write.status).toBe(403);
  });

  it("lets editors write", async () => {
    const { owner, bookId, ref } = await bilingualBook();
    const editor = await h.signedInUser();
    await owner.request("POST", `/books/${bookId}/members`, {
      email: editor.email,
      role: "editor",
    });
    await categoryTree(editor, ref);
  });

  it("hides reference data from other users, even without a filter", async () => {
    const { owner, ref } = await bilingualBook();
    const stranger = await h.signedInUser();
    await categoryTree(owner, ref);

    expect((await stranger.request("GET", ref())).status).toBe(404);
    const seen = await withUser(h.db, stranger.id, (tx) => tx.select().from(category));
    expect(seen).toEqual([]);
    const updated = await withUser(h.db, stranger.id, (tx) =>
      tx.execute(sql`update category set code = 'X' returning id`),
    );
    expect(updated.length).toBe(0);
  });
});

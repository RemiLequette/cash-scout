import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createHarness, household } from "../test/harness.js";
import { ensureSuperUser } from "./auth.js";
import { withUser } from "./db/client.js";
import { book } from "./db/schema.js";

const h = createHarness();
afterAll(() => h.sql.end());

async function createBook(owner: Awaited<ReturnType<typeof h.signedInUser>>) {
  const response = await owner.request("POST", "/books", household);
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string };
}

describe("health", () => {
  it("reports the database", async () => {
    const response = await h.app.request("/api/health");
    expect(await response.json()).toEqual({ status: "ok", database: "ok" });
  });
});

describe("authentication", () => {
  it("rejects requests without a session", async () => {
    expect((await h.app.request("/api/books")).status).toBe(401);
  });

  it("has no public sign-up", async () => {
    const response = await h.app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "new@example.test", password: "x".repeat(12), name: "New" }),
    });
    expect(response.ok).toBe(false);
  });

  it("creates the super user only once", async () => {
    const superUser = { email: "admin@example.test", password: "admin-password-1", name: "Admin" };
    expect(await ensureSuperUser(h.db, h.auth, superUser)).toBe(true);
    expect(await ensureSuperUser(h.db, h.auth, superUser)).toBe(false);
  });
});

describe("books", () => {
  it("makes the creator owner and lists the book", async () => {
    const alice = await h.signedInUser();
    const { id } = await createBook(alice);

    const list = await (await alice.request("GET", "/books")).json();
    expect(list).toEqual([{ id, ...household, role: "owner" }]);
  });

  it("rejects invalid input", async () => {
    const alice = await h.signedInUser();
    const response = await alice.request("POST", "/books", { ...household, currency: "EURO" });
    expect(response.status).toBe(400);
  });

  it("hides a book from non-members, including the super user", async () => {
    const alice = await h.signedInUser();
    const bob = await h.signedInUser();
    const admin = await h.signedInUser({ role: "admin" });
    const { id } = await createBook(alice);

    for (const other of [bob, admin]) {
      expect(await (await other.request("GET", "/books")).json()).toEqual([]);
      expect((await other.request("GET", `/books/${id}`)).status).toBe(404);
      expect((await other.request("DELETE", `/books/${id}`)).status).toBe(404);
    }
  });

  it("lets the owner rename and delete", async () => {
    const alice = await h.signedInUser();
    const { id } = await createBook(alice);

    const renamed = await alice.request("PATCH", `/books/${id}`, {
      name: "Home",
      defaultLanguage: "en",
    });
    expect(await renamed.json()).toMatchObject({ name: "Home", defaultLanguage: "en" });
    expect((await alice.request("DELETE", `/books/${id}`)).status).toBe(204);
    expect((await alice.request("GET", `/books/${id}`)).status).toBe(404);
  });
});

describe("members", () => {
  it("applies roles", async () => {
    const alice = await h.signedInUser();
    const bob = await h.signedInUser();
    const carol = await h.signedInUser();
    const { id } = await createBook(alice);

    const added = await alice.request("POST", `/books/${id}/members`, {
      email: bob.email,
      role: "viewer",
    });
    expect(added.status).toBe(201);

    // A viewer reads but does not change.
    expect((await bob.request("GET", `/books/${id}`)).status).toBe(200);
    expect((await bob.request("GET", `/books/${id}/members`)).status).toBe(200);
    expect(
      (await bob.request("PATCH", `/books/${id}`, { name: "x", defaultLanguage: "fr" })).status,
    ).toBe(403);
    expect(
      (await bob.request("POST", `/books/${id}/members`, { email: carol.email, role: "viewer" }))
        .status,
    ).toBe(403);

    // Promoted to owner, Bob can manage members.
    await alice.request("PATCH", `/books/${id}/members/${bob.id}`, { role: "owner" });
    expect(
      (await bob.request("POST", `/books/${id}/members`, { email: carol.email, role: "editor" }))
        .status,
    ).toBe(201);
    const members = (await (await alice.request("GET", `/books/${id}/members`)).json()) as {
      role: string;
    }[];
    expect(members.map((m) => m.role).sort()).toEqual(["editor", "owner", "owner"]);
  });

  it("keeps at least one owner", async () => {
    const alice = await h.signedInUser();
    const bob = await h.signedInUser();
    const { id } = await createBook(alice);
    await alice.request("POST", `/books/${id}/members`, { email: bob.email, role: "editor" });

    expect(
      (await alice.request("PATCH", `/books/${id}/members/${alice.id}`, { role: "viewer" })).status,
    ).toBe(409);
    expect((await alice.request("DELETE", `/books/${id}/members/${alice.id}`)).status).toBe(409);

    // A member can leave.
    expect((await bob.request("DELETE", `/books/${id}/members/${bob.id}`)).status).toBe(204);
    expect((await bob.request("GET", `/books/${id}`)).status).toBe(404);
  });

  it("reports unknown users and duplicates", async () => {
    const alice = await h.signedInUser();
    const { id } = await createBook(alice);
    const unknown = await alice.request("POST", `/books/${id}/members`, {
      email: "nobody@example.test",
      role: "viewer",
    });
    expect(unknown.status).toBe(404);
    const duplicate = await alice.request("POST", `/books/${id}/members`, {
      email: alice.email,
      role: "viewer",
    });
    expect(duplicate.status).toBe(409);
  });
});

describe("row-level security", () => {
  it("runs as a role that is not the table owner", async () => {
    const [row] = await h.db.execute<{ current_user: string }>(sql`select current_user`);
    expect(row?.current_user).toBe("cashscout_app");
  });

  it("shows no book to a query without a user, even without a filter", async () => {
    const alice = await h.signedInUser();
    await createBook(alice);
    expect(await h.db.select().from(book)).toEqual([]);
  });

  it("shows only the user's books to an unfiltered query", async () => {
    const alice = await h.signedInUser();
    const bob = await h.signedInUser();
    const { id } = await createBook(alice);
    await createBook(bob);

    const seenByAlice = await withUser(h.db, alice.id, (tx) => tx.select().from(book));
    expect(seenByAlice.map((b) => b.id)).toEqual([id]);
  });

  it("refuses to write into another user's book", async () => {
    const alice = await h.signedInUser();
    const bob = await h.signedInUser();
    const { id } = await createBook(alice);

    // Bob tries to add himself as owner of Alice's book, bypassing the API checks.
    await expect(
      withUser(h.db, bob.id, (tx) =>
        tx.execute(
          sql`insert into book_member (book_id, user_id, role) values (${id}, ${bob.id}, 'owner')`,
        ),
      ),
    ).rejects.toThrow();
    const updated = await withUser(h.db, bob.id, (tx) =>
      tx.execute(sql`update book set name = 'hacked' where id = ${id} returning id`),
    );
    expect(updated.length).toBe(0);
  });
});

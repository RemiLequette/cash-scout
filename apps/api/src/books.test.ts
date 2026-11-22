import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createHarness, household, TEST_PASSWORD } from "../test/harness.js";
import { ensureSuperUser, SESSION_DAYS } from "./auth.js";
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

  it("keeps the session cookie 30 days only when asked to stay signed in", async () => {
    const email = "remember@example.test";
    const password = "remember-password-1";
    await h.auth.api.createUser({ body: { email, password, name: "Remember" } });

    async function sessionCookie(rememberMe: boolean) {
      const response = await h.app.request("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, rememberMe }),
      });
      expect(response.status).toBe(200);
      return response.headers.getSetCookie().find((c) => c.includes("session_token="))!;
    }

    // A persistent cookie, for SESSION_DAYS days.
    expect(await sessionCookie(true)).toMatch(new RegExp(`Max-Age=${SESSION_DAYS * 86400}`));
    // A browser-session cookie: no expiry, gone when the browser closes.
    expect(await sessionCookie(false)).not.toMatch(/Max-Age|Expires/i);
  });

  it("creates the super user only once", async () => {
    const superUser = { email: "admin@example.test", password: "admin-password-1", name: "Admin" };
    expect(await ensureSuperUser(h.db, h.auth, superUser)).toBe(true);
    expect(await ensureSuperUser(h.db, h.auth, superUser)).toBe(false);
  });

  describe("passwords", () => {
    const signIn = (email: string, password: string) =>
      h.app.request("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

    it("lets the super user reset a user's password and end their sessions", async () => {
      const admin = await h.signedInUser({ role: "admin" });
      const bob = await h.signedInUser();
      const reset = await admin.request("POST", "/auth/admin/set-user-password", {
        userId: bob.id,
        newPassword: "new-password-from-admin",
      });
      expect(reset.status).toBe(200);
      const revoke = await admin.request("POST", "/auth/admin/revoke-user-sessions", {
        userId: bob.id,
      });
      expect(revoke.status).toBe(200);

      expect((await bob.request("GET", "/books")).status).toBe(401);
      expect((await signIn(bob.email, "new-password-from-admin")).status).toBe(200);
    });

    it("refuses a reset by a user who is not the super user, or a short password", async () => {
      const alice = await h.signedInUser();
      const bob = await h.signedInUser();
      const byUser = await alice.request("POST", "/auth/admin/set-user-password", {
        userId: bob.id,
        newPassword: "alice-sets-bob-password",
      });
      expect(byUser.ok).toBe(false);

      const admin = await h.signedInUser({ role: "admin" });
      const short = await admin.request("POST", "/auth/admin/set-user-password", {
        userId: bob.id,
        newPassword: "short",
      });
      expect(short.ok).toBe(false);
    });

    it("lets users change their own password with the current one", async () => {
      const bob = await h.signedInUser();
      const wrong = await bob.request("POST", "/auth/change-password", {
        currentPassword: "not-the-password",
        newPassword: "bob-new-password-1",
      });
      expect(wrong.ok).toBe(false);
      const changed = await bob.request("POST", "/auth/change-password", {
        currentPassword: TEST_PASSWORD,
        newPassword: "bob-new-password-1",
        revokeOtherSessions: true,
      });
      expect(changed.status).toBe(200);
      expect((await signIn(bob.email, "bob-new-password-1")).status).toBe(200);
    });
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
      languages: ["en"],
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
      (
        await bob.request("PATCH", `/books/${id}`, {
          name: "x",
          defaultLanguage: "fr",
          languages: ["fr"],
        })
      ).status,
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

import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { createAuth } from "../src/auth.js";
import { APP_ROLE, createDb } from "../src/db/client.js";
import { testDatabaseUrl } from "./database.js";

const BASE_URL = "http://localhost:3000";
/** Password of every user made by `signedInUser`. */
export const TEST_PASSWORD = "test-password-123";

/** An app wired to the test database, running as the app role like in production. */
export function createHarness() {
  const { db, sql } = createDb(testDatabaseUrl(), { role: APP_ROLE });
  const auth = createAuth(db, { secret: "test-secret-".repeat(4), baseURL: BASE_URL });
  const app = createApp({ db, auth, pingDatabase: async () => void (await sql`select 1`) });

  /** Creates a user and signs in; returns its id and a request helper carrying its session. */
  async function signedInUser(options: { role?: "admin" | "user" } = {}) {
    const email = `user-${randomUUID()}@example.test`;
    const { user } = await auth.api.createUser({
      body: {
        email,
        password: TEST_PASSWORD,
        name: email.slice(0, 13),
        role: options.role ?? "user",
      },
    });
    const response = await auth.api.signInEmail({
      body: { email, password: TEST_PASSWORD },
      asResponse: true,
    });
    const cookie = response.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");

    function request(method: string, path: string, body?: unknown) {
      return app.request(`/api${path}`, {
        method,
        headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    }

    return { id: user.id, email, request };
  }

  return { app, auth, db, sql, signedInUser };
}

export const household = { name: "Household", currency: "EUR", defaultLanguage: "fr" };

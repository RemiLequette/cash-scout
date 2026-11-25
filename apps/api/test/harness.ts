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

    /** A JSON body is sent as JSON; bytes (a file) are sent as they are. */
    function request(method: string, path: string, body?: unknown) {
      const raw = body instanceof Uint8Array;
      return app.request(`/api${path}`, {
        method,
        headers: {
          cookie,
          ...(body
            ? { "content-type": raw ? "application/octet-stream" : "application/json" }
            : {}),
        },
        body: body ? (raw ? body : JSON.stringify(body)) : undefined,
      });
    }

    return { id: user.id, email, request };
  }

  return { app, auth, db, sql, signedInUser };
}

/** The four natures a new book starts with, in their order. */
export type DefaultNature = "income" | "expense" | "saving" | "transfer";

/** The id of one of the natures a new book starts with. */
export async function defaultNature(
  user: { request: (method: string, path: string) => Response | Promise<Response> },
  bookId: string,
  kind: DefaultNature,
): Promise<string> {
  const response = await user.request("GET", `/books/${bookId}/reference`);
  const { natures } = (await response.json()) as { natures: { id: string; position: number }[] };
  const sorted = [...natures].sort((a, b) => a.position - b.position);
  return sorted[["income", "expense", "saving", "transfer"].indexOf(kind)]!.id;
}

export const household = { name: "Household", currency: "EUR", defaultLanguage: "fr" };

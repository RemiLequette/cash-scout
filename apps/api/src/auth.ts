import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins/admin";
import { eq } from "drizzle-orm";
import type { Db } from "./db/client.js";
import * as schema from "./db/schema.js";

export interface AuthOptions {
  secret: string;
  baseURL: string;
  trustedOrigins?: string[];
}

export function createAuth(db: Db, options: AuthOptions) {
  return betterAuth({
    secret: options.secret,
    baseURL: options.baseURL,
    trustedOrigins: options.trustedOrigins ?? [],
    database: drizzleAdapter(db, { provider: "pg", schema }),
    // Users are created by the super user; there is no public sign-up.
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 10 },
    plugins: [admin()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

export interface SuperUser {
  email: string;
  password: string;
  name: string;
}

/** Creates the super user at first start, when no super user exists yet. */
export async function ensureSuperUser(db: Db, auth: Auth, superUser: SuperUser): Promise<boolean> {
  const existing = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.role, "admin"))
    .limit(1);
  if (existing.length > 0) {
    return false;
  }
  await auth.api.createUser({ body: { ...superUser, role: "admin" } });
  return true;
}

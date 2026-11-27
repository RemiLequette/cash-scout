import { sql as rawSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

/** Role the API runs every query as: subject to row-level security. */
export const APP_ROLE = "cashscout_app";

/**
 * Opens a connection pool. With `role`, every connection switches to that role
 * at start, so all queries run with its rights. Without it, queries run as the
 * login user: only for migrations and administration.
 */
export function createDb(databaseUrl: string, options: { role?: string } = {}) {
  const sql = postgres(databaseUrl, {
    max: 10,
    // Notices (e.g. "already exists, skipping" at each migration run) are not errors.
    onnotice: () => {},
    connection: options.role ? { options: `-c role=${options.role}` } : {},
  });
  const db = drizzle(sql, { schema });
  return { sql, db };
}

export type Db = ReturnType<typeof createDb>["db"];
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Runs `fn` in a transaction where row-level security sees `userId` as the
 * current user. Every access to book data goes through here.
 */
export function withUser<T>(
  db: Db,
  userId: string,
  fn: (tx: Tx) => Promise<T>,
  /** "repeatable read" to read several tables as they were at one instant. */
  isolationLevel?: "repeatable read",
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(rawSql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  }, isolationLevel && { isolationLevel });
}

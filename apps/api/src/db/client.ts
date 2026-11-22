import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export function createDb(databaseUrl: string) {
  // Notices (e.g. "already exists, skipping" at each migration run) are not errors.
  const sql = postgres(databaseUrl, { max: 10, onnotice: () => {} });
  const db = drizzle(sql, { schema });
  return { sql, db };
}

export type Db = ReturnType<typeof createDb>["db"];

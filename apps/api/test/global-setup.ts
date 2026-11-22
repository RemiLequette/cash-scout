import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { createDb } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { testDatabaseUrl } from "./database.js";

export default async function setup() {
  const url = new URL(testDatabaseUrl());
  const name = url.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(name)) {
    throw new Error(`Unexpected test database name: ${name}`);
  }

  const maintenance = new URL(url);
  maintenance.pathname = "/postgres";
  const admin = postgres(maintenance.toString(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE ${name}`);
  await admin.end();

  const { db, sql } = createDb(url.toString());
  await runMigrations(db, fileURLToPath(new URL("../drizzle", import.meta.url)));
  await sql.end();
}

import { loadEnv } from "../env.js";
import { createDb } from "./client.js";
import { runMigrations } from "./migrate.js";

const env = loadEnv();
const { db, sql } = createDb(env.databaseUrl);
await runMigrations(db, env.migrationsDir);
await sql.end();
console.log("Migrations applied");

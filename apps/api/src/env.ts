import { fileURLToPath } from "node:url";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name} (see .env.example)`);
  }
  return value;
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  port: Number(process.env.API_PORT ?? 3000),
  /** Folder of the built front end, served by the API in the local stack and in production. */
  webDist: process.env.WEB_DIST,
  /** Folder of the SQL migrations (apps/api/drizzle, from src/ in dev and from dist/ when built). */
  migrationsDir:
    process.env.MIGRATIONS_DIR ?? fileURLToPath(new URL("../drizzle", import.meta.url)),
};

import { fileURLToPath } from "node:url";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name} (see .env.example)`);
  }
  return value;
}

export function loadEnv() {
  const superUserEmail = process.env.SUPERUSER_EMAIL;
  return {
    /** Login of the database owner: runs migrations; queries then switch to the app role. */
    databaseUrl: required("DATABASE_URL"),
    port: Number(process.env.API_PORT ?? 3000),
    authSecret: required("BETTER_AUTH_SECRET"),
    /** Public URL of the app, e.g. http://localhost:5173 in dev. */
    baseURL: required("BETTER_AUTH_URL"),
    /** Super user created at first start. */
    superUser: superUserEmail
      ? {
          email: superUserEmail,
          password: required("SUPERUSER_PASSWORD"),
          name: process.env.SUPERUSER_NAME ?? "Administrator",
        }
      : undefined,
    /** Folder of the built front end, served by the API in the local stack and in production. */
    webDist: process.env.WEB_DIST,
    /** Folder of the SQL migrations (apps/api/drizzle, from src/ in dev and from dist/ when built). */
    migrationsDir:
      process.env.MIGRATIONS_DIR ?? fileURLToPath(new URL("../drizzle", import.meta.url)),
  };
}

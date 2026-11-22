/**
 * Test database: same server as DATABASE_URL, database name suffixed with
 * "_test". It is dropped and recreated at the start of each test run.
 */
export function loadTestEnv(): void {
  try {
    process.loadEnvFile(new URL("../../../.env", import.meta.url));
  } catch {
    // No .env file: variables come from the environment (CI).
  }
}

export function testDatabaseUrl(): string {
  loadTestEnv();
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error("DATABASE_URL is required to run the API tests (see .env.example)");
  }
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/^\//, "")}_test`;
  return url.toString();
}

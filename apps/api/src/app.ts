import { Hono } from "hono";

export interface AppDeps {
  /** Checks that the database answers. */
  pingDatabase: () => Promise<void>;
}

export function createApp(deps: AppDeps) {
  return new Hono().basePath("/api").get("/health", async (c) => {
    try {
      await deps.pingDatabase();
      return c.json({ status: "ok" as const, database: "ok" as const });
    } catch {
      return c.json({ status: "error" as const, database: "unreachable" as const }, 503);
    }
  });
}

/** Type of the API, used by the front end's typed client. */
export type AppType = ReturnType<typeof createApp>;

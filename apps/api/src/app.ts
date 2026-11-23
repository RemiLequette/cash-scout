import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { Auth } from "./auth.js";
import type { Db } from "./db/client.js";
import { createBookEvents } from "./events.js";
import type { AppEnv } from "./http.js";
import { booksRoutes } from "./routes/books.js";

/** PostgreSQL constraint errors that are the user's to fix, as a message; else undefined. */
function conflictMessage(error: unknown): string | undefined {
  const cause = (error as { cause?: { code?: string } }).cause;
  const code = (error as { code?: string }).code ?? cause?.code;
  if (code === "23505") return "Already exists (duplicate code or name)";
  if (code === "23503") return "Still in use, or refers to an unknown item: archive it instead";
  return undefined;
}

export interface AppDeps {
  db: Db;
  auth: Auth;
  /** Checks that the database answers. */
  pingDatabase: () => Promise<void>;
}

export function createApp({ db, auth, pingDatabase }: AppDeps) {
  const requireUser = createMiddleware<AppEnv>(async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      throw new HTTPException(401, { message: "Not signed in" });
    }
    c.set("user", session.user);
    await next();
  });

  const events = createBookEvents();

  return new Hono<AppEnv>()
    .basePath("/api")
    .onError((error, c) => {
      if (error instanceof HTTPException) {
        return c.json({ error: error.message }, error.status);
      }
      const conflict = conflictMessage(error);
      if (conflict) {
        return c.json({ error: conflict }, 409);
      }
      console.error(error);
      return c.json({ error: "Internal error" }, 500);
    })
    .get("/health", async (c) => {
      try {
        await pingDatabase();
        return c.json({ status: "ok" as const, database: "ok" as const });
      } catch {
        return c.json({ status: "error" as const, database: "unreachable" as const }, 503);
      }
    })
    .on(["GET", "POST"], "/auth/*", (c) => auth.handler(c.req.raw))
    .use("/books", requireUser)
    .use("/books/*", requireUser)
    .route("/books", booksRoutes(db, events));
}

/** Type of the API, used by the front end's typed client. */
export type AppType = ReturnType<typeof createApp>;

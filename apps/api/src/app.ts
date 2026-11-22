import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { Auth } from "./auth.js";
import type { Db } from "./db/client.js";
import type { AppEnv } from "./http.js";
import { booksRoutes } from "./routes/books.js";

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

  return new Hono<AppEnv>()
    .basePath("/api")
    .onError((error, c) => {
      if (error instanceof HTTPException) {
        return c.json({ error: error.message }, error.status);
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
    .route("/books", booksRoutes(db));
}

/** Type of the API, used by the front end's typed client. */
export type AppType = ReturnType<typeof createApp>;

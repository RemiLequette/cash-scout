import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createApp } from "./app.js";
import { createDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { env } from "./env.js";

const { db, sql } = createDb(env.databaseUrl);

await runMigrations(db, env.migrationsDir);

const server = new Hono();
server.route("/", createApp({ pingDatabase: async () => void (await sql`select 1`) }));

if (env.webDist) {
  // Built front end, with index.html as fallback for client-side routes.
  server.use("/*", serveStatic({ root: env.webDist }));
  server.get("*", serveStatic({ root: env.webDist, path: "index.html" }));
}

serve({ fetch: server.fetch, port: env.port }, (info) => {
  console.log(`cash-scout API listening on http://localhost:${info.port}`);
});

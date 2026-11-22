import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createApp } from "./app.js";
import { createAuth, ensureSuperUser } from "./auth.js";
import { APP_ROLE, createDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { loadEnv } from "./env.js";

const env = loadEnv();

// Migrations run as the database owner; everything else as the app role.
const owner = createDb(env.databaseUrl);
await runMigrations(owner.db, env.migrationsDir);
await owner.sql.end();

const { db, sql } = createDb(env.databaseUrl, { role: APP_ROLE });
const auth = createAuth(db, {
  secret: env.authSecret,
  baseURL: env.baseURL,
  trustedOrigins: [env.baseURL],
});

if (env.superUser && (await ensureSuperUser(db, auth, env.superUser))) {
  console.log(`Super user created: ${env.superUser.email}`);
}

const server = new Hono();
server.route("/", createApp({ db, auth, pingDatabase: async () => void (await sql`select 1`) }));

if (env.webDist) {
  // Built front end, with index.html as fallback for client-side routes.
  server.use("/*", serveStatic({ root: env.webDist }));
  server.get("*", serveStatic({ root: env.webDist, path: "index.html" }));
}

serve({ fetch: server.fetch, port: env.port }, (info) => {
  console.log(`cash-scout API listening on http://localhost:${info.port}`);
});

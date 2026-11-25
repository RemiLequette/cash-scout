import { previewOf } from "@cash-scout/domain";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { withUser, type Db } from "../db/client.js";
import type { AppEnv } from "../http.js";
import { readStatementFile } from "../statements/file.js";
import { presets } from "../statements/presets.js";
import { idOf, requireRole } from "./access.js";
import { accountOf, usable } from "./journal.js";

/** A statement is a few hundred lines: a megabyte is far more than a year of them. */
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Bank statements, mounted under /books/:bookId/statements. Reading a file
 * writes nothing: the preview shows what the file holds.
 */
export function statementRoutes(db: Db) {
  return (
    new Hono<AppEnv>()
      .get("/presets", async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        await withUser(db, me, (tx) => requireRole(tx, bookId, me, "editor"));
        return c.json(presets.map(({ id, name }) => ({ id, name })));
      })

      // The body is the file itself; the query names the preset and the account,
      // whose currency the amounts are read in.
      .post("/preview", async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const preset = presets.find((p) => p.id === c.req.query("preset"));
        if (!preset) {
          throw new HTTPException(400, { message: "Unknown statement format" });
        }
        const accountId = idOf(c.req.query("account") ?? "", "Account");
        const content = new Uint8Array(await c.req.arrayBuffer());
        if (content.length === 0) {
          throw new HTTPException(400, { message: "The file is empty" });
        }
        if (content.length > MAX_BYTES) {
          throw new HTTPException(413, { message: "The file is too large" });
        }
        const account = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          return usable(accountOf(tx, bookId, accountId), "account");
        });
        try {
          return c.json(
            previewOf(readStatementFile(content, preset, account.currency), account.currency),
          );
        } catch (error) {
          if (error instanceof RangeError) {
            throw new HTTPException(400, {
              message: `This file does not look like a ${preset.name} statement: ${error.message}`,
            });
          }
          throw error;
        }
      })
  );
}

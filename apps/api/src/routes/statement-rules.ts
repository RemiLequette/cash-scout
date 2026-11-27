import { zValidator } from "@hono/zod-validator";
import { ruleInputSchema, ruleOrderSchema, type RuleFields } from "@cash-scout/domain";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { withUser, type Db, type Tx } from "../db/client.js";
import { importLine, importRule } from "../db/schema.js";
import type { AppEnv } from "../http.js";
import { idOf, requireRole } from "./access.js";
import { subCategoryOf, usable } from "./journal.js";

const columns = {
  id: importRule.id,
  position: importRule.position,
  name: importRule.name,
  text: importRule.text,
  bankCategory: importRule.bankCategory,
  direction: importRule.direction,
  minAmount: importRule.minAmount,
  maxAmount: importRule.maxAmount,
  subCategoryId: importRule.subCategoryId,
  description: importRule.description,
  ignore: importRule.ignore,
};

/** The values to store: the account and sub-category must be of the book, and usable. */
async function values(tx: Tx, bookId: string, rule: RuleFields) {
  if (rule.subCategoryId) {
    await usable(subCategoryOf(tx, bookId, rule.subCategoryId), "sub-category");
  }
  return rule;
}

/**
 * The import rules of a book, mounted under /books/:bookId/statements/rules.
 * Editors and owners read and change them.
 */
export function statementRuleRoutes(db: Db) {
  return (
    new Hono<AppEnv>()
      .get("/", async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const rows = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          return tx
            .select(columns)
            .from(importRule)
            .where(eq(importRule.bookId, bookId))
            .orderBy(asc(importRule.position), asc(importRule.createdAt));
        });
        return c.json(rows);
      })

      .post("/", zValidator("json", ruleInputSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const rule = c.req.valid("json");
        const created = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          await values(tx, bookId, rule);
          const [last] = await tx
            .select({ max: sql<number>`coalesce(max(${importRule.position}), 0)::int` })
            .from(importRule)
            .where(eq(importRule.bookId, bookId));
          const [row] = await tx
            .insert(importRule)
            .values({ ...rule, bookId, position: last!.max + 1 })
            .returning(columns);
          return row!;
        });
        return c.json(created, 201);
      })

      // The new order of the rules; every rule of the book must be named.
      .put("/order", zValidator("json", ruleOrderSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const { ids } = c.req.valid("json");
        await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const rows = await tx
            .select({ id: importRule.id })
            .from(importRule)
            .where(eq(importRule.bookId, bookId));
          if (new Set(ids).size !== ids.length || rows.length !== ids.length) {
            throw new HTTPException(400, { message: "Name every rule once" });
          }
          const known = new Set(rows.map((r) => r.id));
          if (ids.some((id) => !known.has(id))) {
            throw new HTTPException(400, { message: "Unknown rule" });
          }
          for (const [index, id] of ids.entries()) {
            await tx
              .update(importRule)
              .set({ position: index + 1 })
              .where(and(eq(importRule.id, id), eq(importRule.bookId, bookId)));
          }
        });
        return c.body(null, 204);
      })

      .put("/:id", zValidator("json", ruleInputSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Rule");
        const rule = c.req.valid("json");
        const updated = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          await values(tx, bookId, rule);
          const [row] = await tx
            .update(importRule)
            .set(rule)
            .where(and(eq(importRule.id, id), eq(importRule.bookId, bookId)))
            .returning(columns);
          if (!row) throw new HTTPException(404, { message: "Rule not found" });
          return row;
        });
        return c.json(updated);
      })

      .delete("/:id", async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Rule");
        await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          // The proposals it made to lines not yet accepted go with it.
          await tx
            .update(importLine)
            .set({ ruleId: null, subCategoryId: null, description: null })
            .where(
              and(
                eq(importLine.bookId, bookId),
                eq(importLine.ruleId, id),
                eq(importLine.status, "review"),
                isNull(importLine.entryId),
              ),
            );
          const gone = await tx
            .delete(importRule)
            .where(and(eq(importRule.id, id), eq(importRule.bookId, bookId)))
            .returning({ id: importRule.id });
          if (gone.length === 0) throw new HTTPException(404, { message: "Rule not found" });
        });
        return c.body(null, 204);
      })
  );
}

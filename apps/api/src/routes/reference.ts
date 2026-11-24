import { zValidator } from "@hono/zod-validator";
import {
  accountInputSchema,
  accountUpdateSchema,
  categoryInputSchema,
  categoryUpdateSchema,
  checkNames,
  groupInputSchema,
  groupOrderSchema,
  groupUpdateSchema,
  mergeSchema,
  money,
  parseThreshold,
  paymentTypeInputSchema,
  paymentTypeUpdateSchema,
  subCategoryInputSchema,
  subCategoryUpdateSchema,
  toDecimalString,
  type Names,
  makesCycle,
} from "@cash-scout/domain";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { withUser, type Db, type Tx } from "../db/client.js";
import {
  bookAccount,
  category,
  categoryGroup,
  journalEntry,
  paymentType,
  subCategory,
} from "../db/schema.js";
import type { AppEnv } from "../http.js";
import { idOf, languagesOf, missing, requireRole, rowOf } from "./access.js";

/** A table of reference data: every one has id, book_id, names and archived_at. */
type ReferenceTable = PgTable & {
  id: PgColumn;
  bookId: PgColumn;
  names: PgColumn;
  archivedAt: PgColumn;
  version: PgColumn;
};

/** Checks new names against the book's languages; fails with 400. */
async function validNames(tx: Tx, bookId: string, names: Names): Promise<Names> {
  const { languages, defaultLanguage } = await languagesOf(tx, bookId);
  const problem = checkNames(names, languages, defaultLanguage);
  if (problem) {
    throw new HTTPException(400, { message: problem });
  }
  return names;
}

/**
 * Checks the parent a group is given: a group of the same book, not archived,
 * and not the group itself or one of its own descendants. `id` is null for a
 * group being created.
 */
async function checkParent(tx: Tx, bookId: string, id: string | null, parentId?: string | null) {
  if (!parentId) return;
  const groups = await tx
    .select({
      id: categoryGroup.id,
      parentId: categoryGroup.parentId,
      archivedAt: categoryGroup.archivedAt,
    })
    .from(categoryGroup)
    .where(eq(categoryGroup.bookId, bookId));
  const parent = groups.find((g) => g.id === parentId);
  if (!parent) {
    throw new HTTPException(400, { message: "Unknown parent group" });
  }
  // Keeping the archived parent a group already has stays possible; choosing one does not.
  const kept = id !== null && groups.find((g) => g.id === id)?.parentId === parentId;
  if (parent.archivedAt && !kept) {
    throw new HTTPException(400, { message: "The parent group is archived" });
  }
  if (id !== null && makesCycle(id, parentId, new Map(groups.map((g) => [g.id, g.parentId])))) {
    throw new HTTPException(400, { message: "A group cannot be inside itself" });
  }
}

/**
 * Names after an update: the book languages come from the input; names in
 * languages the book no longer uses are kept.
 */
async function mergedNames(
  tx: Tx,
  bookId: string,
  table: ReferenceTable,
  id: string,
  names: Names,
): Promise<Names> {
  await validNames(tx, bookId, names);
  const { languages } = await languagesOf(tx, bookId);
  const [row] = (await tx
    .select({ names: table.names })
    .from(table)
    .where(and(eq(table.id, id), eq(table.bookId, bookId)))) as { names: Names }[];
  if (!row) {
    throw new HTTPException(404, { message: "Item not found" });
  }
  const kept = Object.fromEntries(
    Object.entries(row.names).filter(([language]) => !languages.includes(language)),
  );
  return { ...kept, ...names };
}

/** Archive flag of an update, as the archived_at value to store. */
function archiveValue(archived: boolean | undefined) {
  return archived === undefined ? {} : { archivedAt: archived ? new Date() : null };
}

/** Fails when the update touched no row of the book: 409 with a version, else 404. */
function updatedOne<T>(rows: T[], version?: number): T {
  if (rows.length === 0) {
    return missing("Item", version);
  }
  return rows[0]!;
}

const thresholdText = (minor: bigint | null, currency: string) =>
  minor === null ? null : toDecimalString(money(minor, currency));

function threshold(value: string | null | undefined, currency: string) {
  try {
    return parseThreshold(value, currency);
  } catch (error) {
    throw new HTTPException(400, { message: (error as Error).message });
  }
}

const groupColumns = {
  version: categoryGroup.version,
  id: categoryGroup.id,
  names: categoryGroup.names,
  position: categoryGroup.position,
  parentId: categoryGroup.parentId,
  color: categoryGroup.color,
  archivedAt: categoryGroup.archivedAt,
};
const categoryColumns = {
  version: category.version,
  id: category.id,
  groupId: category.groupId,
  code: category.code,
  direction: category.direction,
  defaultBudgetType: category.defaultBudgetType,
  names: category.names,
  archivedAt: category.archivedAt,
};
const subCategoryColumns = {
  version: subCategory.version,
  id: subCategory.id,
  categoryId: subCategory.categoryId,
  names: subCategory.names,
  archivedAt: subCategory.archivedAt,
};
const paymentTypeColumns = {
  version: paymentType.version,
  id: paymentType.id,
  names: paymentType.names,
  archivedAt: paymentType.archivedAt,
};
const accountColumns = {
  version: bookAccount.version,
  id: bookAccount.id,
  names: bookAccount.names,
  kind: bookAccount.kind,
  currency: bookAccount.currency,
  lowBalanceThreshold: bookAccount.lowBalanceThreshold,
  archivedAt: bookAccount.archivedAt,
};

/** Shapes rows for JSON: `archived` flag instead of a date, thresholds as decimal text. */
const out = <T extends { archivedAt: Date | null }>({ archivedAt, ...rest }: T) => ({
  ...rest,
  archived: archivedAt !== null,
});
const outAccount = (row: {
  id: string;
  version: number;
  names: Names;
  kind: "bank" | "virtual";
  currency: string;
  lowBalanceThreshold: bigint | null;
  archivedAt: Date | null;
}) => out({ ...row, lowBalanceThreshold: thresholdText(row.lowBalanceThreshold, row.currency) });

/**
 * Reference data of a book, mounted under /books/:bookId/reference.
 * Members read; editors and owners write.
 */
export function referenceRoutes(db: Db) {
  return (
    new Hono<AppEnv>()
      .get("/", async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const result = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "viewer");
          const byBook = <T extends ReferenceTable>(t: T) => eq(t.bookId, bookId);
          const [languages, groups, categories, subCategories, paymentTypes, accounts] =
            await Promise.all([
              languagesOf(tx, bookId),
              tx
                .select(groupColumns)
                .from(categoryGroup)
                .where(byBook(categoryGroup))
                .orderBy(asc(categoryGroup.position)),
              tx
                .select(categoryColumns)
                .from(category)
                .where(byBook(category))
                .orderBy(asc(category.code)),
              tx.select(subCategoryColumns).from(subCategory).where(byBook(subCategory)),
              tx.select(paymentTypeColumns).from(paymentType).where(byBook(paymentType)),
              tx.select(accountColumns).from(bookAccount).where(byBook(bookAccount)),
            ]);
          return {
            ...languages,
            groups: groups.map(out),
            categories: categories.map(out),
            subCategories: subCategories.map(out),
            paymentTypes: paymentTypes.map(out),
            accounts: accounts.map(outAccount),
          };
        });
        return c.json(result);
      })

      // Groups ---------------------------------------------------------------
      .post("/groups", zValidator("json", groupInputSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const input = c.req.valid("json");
        const row = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const names = await validNames(tx, bookId, input.names);
          await checkParent(tx, bookId, null, input.parentId);
          const [created] = await tx
            .insert(categoryGroup)
            .values({
              bookId,
              names,
              position: input.position ?? 0,
              parentId: input.parentId ?? null,
              color: input.color ?? null,
            })
            .returning(groupColumns);
          return created!;
        });
        return c.json(out(row), 201);
      })
      .patch("/groups/:id", zValidator("json", groupUpdateSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Item");
        const { names, archived, version, ...input } = c.req.valid("json");
        const row = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          if (input.parentId !== undefined) await checkParent(tx, bookId, id, input.parentId);
          return updatedOne(
            await tx
              .update(categoryGroup)
              .set({
                ...input,
                ...archiveValue(archived),
                ...(names && { names: await mergedNames(tx, bookId, categoryGroup, id, names) }),
              })
              .where(rowOf(categoryGroup, bookId, id, version))
              .returning(groupColumns),
            version,
          );
        });
        return c.json(out(row));
      })
      // The order of sibling groups, in one go: each takes its place in the list.
      .post("/groups/reorder", zValidator("json", groupOrderSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const { ids } = c.req.valid("json");
        if (new Set(ids).size !== ids.length) {
          throw new HTTPException(400, { message: "A group appears once" });
        }
        await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const found = await tx
            .select({ id: categoryGroup.id })
            .from(categoryGroup)
            .where(and(eq(categoryGroup.bookId, bookId), inArray(categoryGroup.id, ids)));
          if (found.length !== ids.length) {
            throw new HTTPException(400, { message: "Unknown group" });
          }
          for (const [position, id] of ids.entries()) {
            await tx
              .update(categoryGroup)
              .set({ position })
              .where(and(eq(categoryGroup.id, id), eq(categoryGroup.bookId, bookId)));
          }
        });
        return c.body(null, 204);
      })
      .delete("/groups/:id", async (c) =>
        deleteItem(c, db, categoryGroup, idOf(c.req.param("id"), "Item")),
      )

      // Categories -------------------------------------------------------------
      .post("/categories", zValidator("json", categoryInputSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const input = c.req.valid("json");
        const row = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const names = await validNames(tx, bookId, input.names);
          const [created] = await tx
            .insert(category)
            .values({ ...input, bookId, names })
            .returning(categoryColumns);
          return created!;
        });
        return c.json(out(row), 201);
      })
      .patch("/categories/:id", zValidator("json", categoryUpdateSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Item");
        const { names, archived, version, ...input } = c.req.valid("json");
        const row = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          return updatedOne(
            await tx
              .update(category)
              .set({
                ...input,
                ...archiveValue(archived),
                ...(names && { names: await mergedNames(tx, bookId, category, id, names) }),
              })
              .where(rowOf(category, bookId, id, version))
              .returning(categoryColumns),
            version,
          );
        });
        return c.json(out(row));
      })
      .delete("/categories/:id", async (c) =>
        deleteItem(c, db, category, idOf(c.req.param("id"), "Item")),
      )

      // Sub-categories ---------------------------------------------------------
      .post("/sub-categories", zValidator("json", subCategoryInputSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const input = c.req.valid("json");
        const row = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const names = await validNames(tx, bookId, input.names);
          const [created] = await tx
            .insert(subCategory)
            .values({ ...input, bookId, names })
            .returning(subCategoryColumns);
          return created!;
        });
        return c.json(out(row), 201);
      })
      .patch("/sub-categories/:id", zValidator("json", subCategoryUpdateSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Item");
        const { names, archived, version, ...input } = c.req.valid("json");
        const row = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          return updatedOne(
            await tx
              .update(subCategory)
              .set({
                ...input,
                ...archiveValue(archived),
                ...(names && { names: await mergedNames(tx, bookId, subCategory, id, names) }),
              })
              .where(rowOf(subCategory, bookId, id, version))
              .returning(subCategoryColumns),
            version,
          );
        });
        return c.json(out(row));
      })
      .delete("/sub-categories/:id", async (c) =>
        deleteItem(c, db, subCategory, idOf(c.req.param("id"), "Item")),
      )
      // Moves every entry of a sub-category to another one, then deletes it.
      .post("/sub-categories/:id/merge", zValidator("json", mergeSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Item");
        const { targetId } = c.req.valid("json");
        if (targetId === id) {
          throw new HTTPException(400, { message: "A sub-category cannot merge into itself" });
        }
        const moved = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const found = await tx
            .select({ id: subCategory.id })
            .from(subCategory)
            .where(and(eq(subCategory.bookId, bookId), inArray(subCategory.id, [id, targetId])));
          if (!found.some((s) => s.id === id)) {
            throw new HTTPException(404, { message: "Item not found" });
          }
          if (!found.some((s) => s.id === targetId)) {
            throw new HTTPException(400, { message: "Unknown target sub-category" });
          }
          const entries = await tx
            .update(journalEntry)
            .set({ subCategoryId: targetId })
            .where(and(eq(journalEntry.bookId, bookId), eq(journalEntry.subCategoryId, id)))
            .returning({ id: journalEntry.id });
          await tx
            .delete(subCategory)
            .where(and(eq(subCategory.id, id), eq(subCategory.bookId, bookId)));
          return entries.length;
        });
        return c.json({ moved });
      })

      // Payment types ----------------------------------------------------------
      .post("/payment-types", zValidator("json", paymentTypeInputSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const input = c.req.valid("json");
        const row = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const names = await validNames(tx, bookId, input.names);
          const [created] = await tx
            .insert(paymentType)
            .values({ bookId, names })
            .returning(paymentTypeColumns);
          return created!;
        });
        return c.json(out(row), 201);
      })
      .patch("/payment-types/:id", zValidator("json", paymentTypeUpdateSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Item");
        const { names, archived, version } = c.req.valid("json");
        const row = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          return updatedOne(
            await tx
              .update(paymentType)
              .set({
                ...archiveValue(archived),
                ...(names && { names: await mergedNames(tx, bookId, paymentType, id, names) }),
              })
              .where(rowOf(paymentType, bookId, id, version))
              .returning(paymentTypeColumns),
            version,
          );
        });
        return c.json(out(row));
      })
      .delete("/payment-types/:id", async (c) =>
        deleteItem(c, db, paymentType, idOf(c.req.param("id"), "Item")),
      )

      // Accounts ---------------------------------------------------------------
      .post("/accounts", zValidator("json", accountInputSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const input = c.req.valid("json");
        const row = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const names = await validNames(tx, bookId, input.names);
          const [created] = await tx
            .insert(bookAccount)
            .values({
              bookId,
              names,
              kind: input.kind,
              currency: input.currency,
              lowBalanceThreshold: threshold(input.lowBalanceThreshold, input.currency),
            })
            .returning(accountColumns);
          return created!;
        });
        return c.json(outAccount(row), 201);
      })
      .patch("/accounts/:id", zValidator("json", accountUpdateSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Item");
        const { names, archived, lowBalanceThreshold, version } = c.req.valid("json");
        const row = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const [current] = await tx
            .select({ currency: bookAccount.currency })
            .from(bookAccount)
            .where(and(eq(bookAccount.id, id), eq(bookAccount.bookId, bookId)));
          if (!current) {
            throw new HTTPException(404, { message: "Item not found" });
          }
          return updatedOne(
            await tx
              .update(bookAccount)
              .set({
                ...archiveValue(archived),
                ...(names && { names: await mergedNames(tx, bookId, bookAccount, id, names) }),
                ...(lowBalanceThreshold !== undefined && {
                  lowBalanceThreshold: threshold(lowBalanceThreshold, current.currency),
                }),
              })
              .where(rowOf(bookAccount, bookId, id, version))
              .returning(accountColumns),
            version,
          );
        });
        return c.json(outAccount(row));
      })
      .delete("/accounts/:id", async (c) =>
        deleteItem(c, db, bookAccount, idOf(c.req.param("id"), "Item")),
      )
  );
}

/**
 * Deletes an item. An item still used (a group with categories, a
 * sub-category with entries) is refused by its foreign keys: archive it instead.
 */
async function deleteItem(
  c: {
    var: AppEnv["Variables"];
    req: { param(name: string): string | undefined };
    body(b: null, s: 204): Response;
  },
  db: Db,
  table: ReferenceTable,
  id: string,
) {
  const me = c.var.user.id;
  const bookId = idOf(c.req.param("bookId"));
  await withUser(db, me, async (tx) => {
    await requireRole(tx, bookId, me, "editor");
    const deleted = await tx
      .delete(table)
      .where(and(eq(table.id, id), eq(table.bookId, bookId)))
      .returning({ id: table.id });
    updatedOne(deleted);
  });
  return c.body(null, 204);
}

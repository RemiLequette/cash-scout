import { zValidator } from "@hono/zod-validator";
import {
  accountInputSchema,
  accountUpdateSchema,
  categoryInputSchema,
  categoryUpdateSchema,
  checkNames,
  groupInputSchema,
  groupUpdateSchema,
  money,
  parseThreshold,
  paymentTypeInputSchema,
  paymentTypeUpdateSchema,
  subCategoryInputSchema,
  subCategoryUpdateSchema,
  toDecimalString,
  type Names,
} from "@cash-scout/domain";
import { and, asc, eq } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { withUser, type Db, type Tx } from "../db/client.js";
import { bookAccount, category, categoryGroup, paymentType, subCategory } from "../db/schema.js";
import type { AppEnv } from "../http.js";
import { idOf, languagesOf, requireRole } from "./access.js";

/** A table of reference data: every one has id, book_id, names and archived_at. */
type ReferenceTable = PgTable & {
  id: PgColumn;
  bookId: PgColumn;
  names: PgColumn;
  archivedAt: PgColumn;
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

/** Fails with 404 when the update touched no row of the book. */
function updatedOne<T>(rows: T[]): T {
  if (rows.length === 0) {
    throw new HTTPException(404, { message: "Item not found" });
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
  id: categoryGroup.id,
  names: categoryGroup.names,
  position: categoryGroup.position,
  archivedAt: categoryGroup.archivedAt,
};
const categoryColumns = {
  id: category.id,
  groupId: category.groupId,
  code: category.code,
  direction: category.direction,
  names: category.names,
  archivedAt: category.archivedAt,
};
const subCategoryColumns = {
  id: subCategory.id,
  categoryId: subCategory.categoryId,
  names: subCategory.names,
  archivedAt: subCategory.archivedAt,
};
const paymentTypeColumns = {
  id: paymentType.id,
  names: paymentType.names,
  archivedAt: paymentType.archivedAt,
};
const accountColumns = {
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
          const [created] = await tx
            .insert(categoryGroup)
            .values({ bookId, names, position: input.position ?? 0 })
            .returning(groupColumns);
          return created!;
        });
        return c.json(out(row), 201);
      })
      .patch("/groups/:id", zValidator("json", groupUpdateSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Item");
        const { names, archived, ...input } = c.req.valid("json");
        const row = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          return updatedOne(
            await tx
              .update(categoryGroup)
              .set({
                ...input,
                ...archiveValue(archived),
                ...(names && { names: await mergedNames(tx, bookId, categoryGroup, id, names) }),
              })
              .where(and(eq(categoryGroup.id, id), eq(categoryGroup.bookId, bookId)))
              .returning(groupColumns),
          );
        });
        return c.json(out(row));
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
        const { names, archived, ...input } = c.req.valid("json");
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
              .where(and(eq(category.id, id), eq(category.bookId, bookId)))
              .returning(categoryColumns),
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
        const { names, archived, ...input } = c.req.valid("json");
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
              .where(and(eq(subCategory.id, id), eq(subCategory.bookId, bookId)))
              .returning(subCategoryColumns),
          );
        });
        return c.json(out(row));
      })
      .delete("/sub-categories/:id", async (c) =>
        deleteItem(c, db, subCategory, idOf(c.req.param("id"), "Item")),
      )

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
        const { names, archived } = c.req.valid("json");
        const row = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          return updatedOne(
            await tx
              .update(paymentType)
              .set({
                ...archiveValue(archived),
                ...(names && { names: await mergedNames(tx, bookId, paymentType, id, names) }),
              })
              .where(and(eq(paymentType.id, id), eq(paymentType.bookId, bookId)))
              .returning(paymentTypeColumns),
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
        const { names, archived, lowBalanceThreshold } = c.req.valid("json");
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
              .where(and(eq(bookAccount.id, id), eq(bookAccount.bookId, bookId)))
              .returning(accountColumns),
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
 * Deletes an item. An item still used (a group with categories, later a
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

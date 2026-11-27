import { zValidator } from "@hono/zod-validator";
import {
  accountInputSchema,
  bookAmount,
  openingFromBalance,
  openingInputSchema,
  parseAmount,
  resolveRate,
  accountUpdateSchema,
  balanceInputSchema,
  balanceUpdateSchema,
  categoryInputSchema,
  categoryUpdateSchema,
  checkNames,
  groupInputSchema,
  groupOrderSchema,
  groupUpdateSchema,
  lineOrderSchema,
  mergeSchema,
  money,
  natureInputSchema,
  natureUpdateSchema,
  parseThreshold,
  subCategoryInputSchema,
  subCategoryUpdateSchema,
  toDecimalString,
  type Names,
  makesCycle,
} from "@cash-scout/domain";
import { and, asc, desc, eq, inArray, isNotNull, lte, max, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { withUser, type Db, type Tx } from "../db/client.js";
import {
  balance,
  balanceNature,
  bookAccount,
  category,
  categoryGroup,
  importLine,
  journalEntry,
  nature,
  subCategory,
} from "../db/schema.js";
import type { AppEnv } from "../http.js";
import { checked, idOf, languagesOf, missing, requireRole, rowOf } from "./access.js";
import { requireUnused } from "./in-use.js";
import { bookCurrencyOf } from "./journal.js";

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
 * Checks the nature a category is given: it must be one of the book, and not
 * archived, though a category may keep the archived one it has.
 */
async function checkNature(tx: Tx, bookId: string, id: string, current?: string) {
  const [found] = await tx
    .select({ archivedAt: nature.archivedAt })
    .from(nature)
    .where(and(eq(nature.id, id), eq(nature.bookId, bookId)));
  if (!found) {
    throw new HTTPException(400, { message: "Unknown nature" });
  }
  if (found.archivedAt && id !== current) {
    throw new HTTPException(400, { message: "The nature is archived" });
  }
}

/** The next free place at the end of the list shared by the natures and balances. */
async function nextLinePosition(tx: Tx, bookId: string) {
  const [[natures], [balances]] = await Promise.all([
    tx
      .select({ at: max(nature.position) })
      .from(nature)
      .where(eq(nature.bookId, bookId)),
    tx
      .select({ at: max(balance.position) })
      .from(balance)
      .where(eq(balance.bookId, bookId)),
  ]);
  return Math.max(natures?.at ?? -1, balances?.at ?? -1) + 1;
}

/** Checks the natures a balance adds up: all of the book. */
async function checkNatures(tx: Tx, bookId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  const found = await tx
    .select({ id: nature.id })
    .from(nature)
    .where(and(eq(nature.bookId, bookId), inArray(nature.id, unique)));
  if (found.length !== unique.length) {
    throw new HTTPException(400, { message: "Unknown nature" });
  }
  return unique;
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
const natureColumns = {
  version: nature.version,
  id: nature.id,
  names: nature.names,
  sign: nature.sign,
  transfer: nature.transfer,
  position: nature.position,
  archivedAt: nature.archivedAt,
};
const balanceColumns = {
  version: balance.version,
  id: balance.id,
  names: balance.names,
  position: balance.position,
  archivedAt: balance.archivedAt,
};
const categoryColumns = {
  version: category.version,
  id: category.id,
  groupId: category.groupId,
  code: category.code,
  natureId: category.natureId,
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
const accountColumns = {
  version: bookAccount.version,
  id: bookAccount.id,
  names: bookAccount.names,
  currency: bookAccount.currency,
  lowBalanceThreshold: bookAccount.lowBalanceThreshold,
  openingBalance: bookAccount.openingBalance,
  openingBookAmount: bookAccount.openingBookAmount,
  archivedAt: bookAccount.archivedAt,
};

/** Shapes rows for JSON: `archived` flag instead of a date, thresholds as decimal text. */
const out = <T extends { archivedAt: Date | null }>({ archivedAt, ...rest }: T) => ({
  ...rest,
  archived: archivedAt !== null,
});
const omitBookAmount = <T extends { openingBookAmount: bigint }>(
  row: T,
): Omit<T, "openingBookAmount"> => {
  const { openingBookAmount, ...rest } = row;
  void openingBookAmount;
  return rest;
};
const outAccount = (row: {
  id: string;
  version: number;
  names: Names;
  currency: string;
  lowBalanceThreshold: bigint | null;
  openingBalance: bigint;
  openingBookAmount: bigint;
  archivedAt: Date | null;
}) =>
  out({
    // The opening balance in the book currency is for the reports, not for the screens.
    ...omitBookAmount(row),
    lowBalanceThreshold: thresholdText(row.lowBalanceThreshold, row.currency),
    openingBalance: toDecimalString(money(row.openingBalance, row.currency)),
  });

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
          const [
            languages,
            natures,
            balances,
            balanceNatures,
            groups,
            categories,
            subCategories,
            accounts,
          ] = await Promise.all([
            languagesOf(tx, bookId),
            tx
              .select(natureColumns)
              .from(nature)
              .where(byBook(nature))
              .orderBy(asc(nature.position)),
            tx
              .select(balanceColumns)
              .from(balance)
              .where(byBook(balance))
              .orderBy(asc(balance.position)),
            tx
              .select({ balanceId: balanceNature.balanceId, natureId: balanceNature.natureId })
              .from(balanceNature)
              .where(eq(balanceNature.bookId, bookId)),
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
            tx.select(accountColumns).from(bookAccount).where(byBook(bookAccount)),
          ]);
          return {
            ...languages,
            natures: natures.map(out),
            balances: balances.map((b) =>
              out({
                ...b,
                natureIds: balanceNatures
                  .filter((x) => x.balanceId === b.id)
                  .map((x) => x.natureId),
              }),
            ),
            groups: groups.map(out),
            categories: categories.map(out),
            subCategories: subCategories.map(out),
            accounts: accounts.map(outAccount),
          };
        });
        return c.json(result);
      })

      // Natures and balances ---------------------------------------------------
      .post("/natures", zValidator("json", natureInputSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const input = c.req.valid("json");
        const row = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const names = await validNames(tx, bookId, input.names);
          const [created] = await tx
            .insert(nature)
            .values({ ...input, bookId, names, position: await nextLinePosition(tx, bookId) })
            .returning(natureColumns);
          return created!;
        });
        return c.json(out(row), 201);
      })
      .patch("/natures/:id", zValidator("json", natureUpdateSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Item");
        const { names, archived, version, ...input } = c.req.valid("json");
        const row = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const updated = updatedOne(
            await tx
              .update(nature)
              .set({
                ...input,
                ...archiveValue(archived),
                ...(names && { names: await mergedNames(tx, bookId, nature, id, names) }),
              })
              .where(rowOf(nature, bookId, id, version))
              .returning(natureColumns),
            version,
          );
          return updated;
        });
        return c.json(out(row));
      })
      .delete("/natures/:id", async (c) =>
        deleteItem(c, db, nature, idOf(c.req.param("id"), "Item")),
      )
      .post("/balances", zValidator("json", balanceInputSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const input = c.req.valid("json");
        const row = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const names = await validNames(tx, bookId, input.names);
          const natureIds = await checkNatures(tx, bookId, input.natureIds);
          const [created] = await tx
            .insert(balance)
            .values({ bookId, names, position: await nextLinePosition(tx, bookId) })
            .returning(balanceColumns);
          await tx
            .insert(balanceNature)
            .values(natureIds.map((natureId) => ({ bookId, balanceId: created!.id, natureId })));
          return { ...created!, natureIds };
        });
        return c.json(out(row), 201);
      })
      .patch("/balances/:id", zValidator("json", balanceUpdateSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Item");
        const { names, archived, version, natureIds } = c.req.valid("json");
        const row = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const checked = natureIds && (await checkNatures(tx, bookId, natureIds));
          const updated = updatedOne(
            await tx
              .update(balance)
              .set({
                ...archiveValue(archived),
                ...(names && { names: await mergedNames(tx, bookId, balance, id, names) }),
                // The version moves when only the natures change.
                ...(checked && { version: sql`${balance.version} + 1` }),
              })
              .where(rowOf(balance, bookId, id, version))
              .returning(balanceColumns),
            version,
          );
          if (checked) {
            await tx.delete(balanceNature).where(eq(balanceNature.balanceId, id));
            await tx
              .insert(balanceNature)
              .values(checked.map((natureId) => ({ bookId, balanceId: id, natureId })));
          }
          const current = await tx
            .select({ natureId: balanceNature.natureId })
            .from(balanceNature)
            .where(eq(balanceNature.balanceId, id));
          return { ...updated, natureIds: current.map((n) => n.natureId) };
        });
        return c.json(out(row));
      })
      .delete("/balances/:id", async (c) =>
        deleteItem(c, db, balance, idOf(c.req.param("id"), "Item")),
      )
      // The order of the natures and balances, which are one list.
      .post("/lines/reorder", zValidator("json", lineOrderSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const { items } = c.req.valid("json");
        if (new Set(items.map((i) => `${i.kind}:${i.id}`)).size !== items.length) {
          throw new HTTPException(400, { message: "A line appears once" });
        }
        await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const idsOf = (kind: "nature" | "balance") =>
            items.filter((i) => i.kind === kind).map((i) => i.id);
          const [natures, balances] = await Promise.all([
            tx
              .select({ id: nature.id })
              .from(nature)
              .where(and(eq(nature.bookId, bookId), inArray(nature.id, idsOf("nature")))),
            tx
              .select({ id: balance.id })
              .from(balance)
              .where(and(eq(balance.bookId, bookId), inArray(balance.id, idsOf("balance")))),
          ]);
          if (
            natures.length !== idsOf("nature").length ||
            balances.length !== idsOf("balance").length
          ) {
            throw new HTTPException(400, { message: "Unknown line" });
          }
          for (const [position, { kind, id }] of items.entries()) {
            const table = kind === "nature" ? nature : balance;
            await tx
              .update(table)
              .set({ position })
              .where(and(eq(table.id, id), eq(table.bookId, bookId)));
          }
        });
        return c.body(null, 204);
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
          await checkNature(tx, bookId, input.natureId);
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
          if (input.natureId) {
            const [current] = await tx
              .select({ natureId: category.natureId })
              .from(category)
              .where(and(eq(category.id, id), eq(category.bookId, bookId)));
            await checkNature(tx, bookId, input.natureId, current?.natureId);
          }
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
          // A compensation keeps two different sub-categories.
          const both = await tx
            .select({ id: journalEntry.compensationId })
            .from(journalEntry)
            .where(
              and(
                eq(journalEntry.bookId, bookId),
                inArray(journalEntry.subCategoryId, [id, targetId]),
                isNotNull(journalEntry.compensationId),
              ),
            )
            .groupBy(journalEntry.compensationId)
            .having(sql`count(*) > 1`)
            .limit(1);
          if (both.length > 0) {
            throw new HTTPException(400, {
              message: "A compensation uses both sub-categories: change it before merging",
            });
          }
          const entries = await tx
            .update(journalEntry)
            .set({ subCategoryId: targetId })
            .where(and(eq(journalEntry.bookId, bookId), eq(journalEntry.subCategoryId, id)))
            .returning({ id: journalEntry.id });
          // The choices made in statement reviews follow.
          await tx
            .update(importLine)
            .set({ subCategoryId: targetId })
            .where(and(eq(importLine.bookId, bookId), eq(importLine.subCategoryId, id)));
          await tx
            .delete(subCategory)
            .where(and(eq(subCategory.id, id), eq(subCategory.bookId, bookId)));
          return entries.length;
        });
        return c.json({ moved });
      })

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
      // The opening balance: set to an amount, or from a balance read at the bank
      // (the reconciled entries then add up to it).
      .post("/accounts/:id/opening", zValidator("json", openingInputSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Item");
        const input = c.req.valid("json");
        const row = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const [current] = await tx
            .select({ currency: bookAccount.currency })
            .from(bookAccount)
            .where(and(eq(bookAccount.id, id), eq(bookAccount.bookId, bookId)));
          if (!current) {
            throw new HTTPException(404, { message: "Item not found" });
          }
          const { currency } = current;
          let opening: bigint;
          if (input.opening !== undefined) {
            opening = checked(() => parseAmount(input.opening!, currency)).minor;
          } else {
            const balance = checked(() => parseAmount(input.balance!, currency)).minor;
            const [sum] = await tx
              .select({ total: sql<string>`coalesce(sum(${journalEntry.amount}), 0)` })
              .from(journalEntry)
              .where(
                and(
                  eq(journalEntry.accountId, id),
                  eq(journalEntry.reconciled, true),
                  input.upTo ? lte(journalEntry.date, input.upTo) : undefined,
                ),
              );
            opening = openingFromBalance(balance, BigInt(sum!.total));
          }
          const bookCurrency = await bookCurrencyOf(tx, bookId);
          // The rate: the one given, else the account's latest, which an account
          // in the book currency does not need.
          let rate = input.exchangeRate;
          if (rate === undefined && currency !== bookCurrency) {
            const [last] = await tx
              .select({ rate: journalEntry.exchangeRate })
              .from(journalEntry)
              .where(eq(journalEntry.accountId, id))
              .orderBy(desc(journalEntry.date))
              .limit(1);
            rate = last?.rate;
          }
          const used = checked(() => resolveRate(currency, bookCurrency, rate));
          const inBook = bookAmount(money(opening, currency), used, bookCurrency).minor;
          return updatedOne(
            await tx
              .update(bookAccount)
              .set({ openingBalance: opening, openingBookAmount: inBook })
              .where(rowOf(bookAccount, bookId, id, input.version))
              .returning(accountColumns),
            input.version,
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
 * sub-category with entries) is refused, saying by what: archive it instead.
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
    await requireUnused(tx, table, bookId, id);
    const deleted = await tx
      .delete(table)
      .where(and(eq(table.id, id), eq(table.bookId, bookId)))
      .returning({ id: table.id });
    updatedOne(deleted);
  });
  return c.body(null, 204);
}

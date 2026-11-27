import { zValidator } from "@hono/zod-validator";
import { compensationInputSchema, compensationUpdateSchema, parseAmount } from "@cash-scout/domain";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";
import { withUser, type Db, type Tx } from "../db/client.js";
import { category, compensation, journalEntry, nature, subCategory } from "../db/schema.js";
import type { AppEnv } from "../http.js";
import { checked, idOf, missing, requireRole, rowOf } from "./access.js";
import { bookCurrencyOf, entryColumns, outEntry, usable } from "./journal.js";

/** A sub-category of the book whose category counts in the totals. */
async function countedSubCategory(tx: Tx, bookId: string, id: string, allowArchived: boolean) {
  const [row] = await tx
    .select({ archivedAt: subCategory.archivedAt, transfer: nature.transfer })
    .from(subCategory)
    .innerJoin(category, eq(category.id, subCategory.categoryId))
    .innerJoin(nature, eq(nature.id, category.natureId))
    .where(and(eq(subCategory.id, id), eq(subCategory.bookId, bookId)));
  const found = await usable(Promise.resolve(row ? [row] : []), "sub-category", allowArchived);
  if (found.transfer) {
    throw new HTTPException(400, {
      message: "A compensation cannot use a sub-category of a transfer category",
    });
  }
}

/** Both sides of a compensation. */
async function readCompensation(tx: Tx, bookId: string, id: string) {
  const [header] = await tx
    .select({ id: compensation.id, version: compensation.version })
    .from(compensation)
    .where(and(eq(compensation.id, id), eq(compensation.bookId, bookId)));
  if (!header) {
    throw new HTTPException(404, { message: "Compensation not found" });
  }
  const rows = await tx
    .select(entryColumns)
    .from(journalEntry)
    .where(and(eq(journalEntry.compensationId, id), eq(journalEntry.bookId, bookId)));
  const plus = rows.find((row) => row.compensationSide === "plus");
  const minus = rows.find((row) => row.compensationSide === "minus");
  if (!plus || !minus) {
    throw new HTTPException(500, { message: "A compensation lost one of its sides" });
  }
  return { header, plus, minus };
}

async function respond(tx: Tx, bookId: string, id: string) {
  const [{ header, plus, minus }, bookCurrency] = await Promise.all([
    readCompensation(tx, bookId, id),
    bookCurrencyOf(tx, bookId),
  ]);
  return {
    id: header.id,
    version: header.version,
    plus: outEntry(plus, bookCurrency, bookCurrency),
    minus: outEntry(minus, bookCurrency, bookCurrency),
  };
}

/** What a side holds for an amount in the book currency: nothing planned or to reconcile. */
const side = (minor: bigint) => ({
  amount: minor,
  bookAmount: minor,
  plannedAmount: 0n,
  exchangeRate: "1",
  reconciled: true,
});

/** Creates a compensation and its two entries; returns its id. */
async function createCompensation(
  tx: Tx,
  bookId: string,
  input: z.output<typeof compensationInputSchema>,
) {
  await countedSubCategory(tx, bookId, input.plusSubCategoryId, false);
  await countedSubCategory(tx, bookId, input.minusSubCategoryId, false);
  const bookCurrency = await bookCurrencyOf(tx, bookId);
  const { minor } = checked(() => parseAmount(input.amount, bookCurrency));
  const [created] = await tx
    .insert(compensation)
    .values({ bookId })
    .returning({ id: compensation.id });
  const shared = {
    bookId,
    compensationId: created!.id,
    date: input.date,
    description: input.description,
  };
  await tx.insert(journalEntry).values([
    {
      ...shared,
      ...side(minor),
      compensationSide: "plus" as const,
      subCategoryId: input.plusSubCategoryId,
    },
    {
      ...shared,
      ...side(-minor),
      compensationSide: "minus" as const,
      subCategoryId: input.minusSubCategoryId,
    },
  ]);
  return created!.id;
}

/** Changes both sides of a compensation; with `version`, only if nobody changed it since. */
async function updateCompensation(
  tx: Tx,
  bookId: string,
  id: string,
  input: Omit<z.output<typeof compensationUpdateSchema>, "version">,
  version?: number,
) {
  const { plus, minus } = await readCompensation(tx, bookId, id);
  const plusSubCategoryId = input.plusSubCategoryId ?? plus.subCategoryId;
  const minusSubCategoryId = input.minusSubCategoryId ?? minus.subCategoryId;
  if (plusSubCategoryId === minusSubCategoryId) {
    throw new HTTPException(400, {
      message: "A compensation needs two different sub-categories",
    });
  }
  // A sub-category the compensation already uses stays allowed once archived,
  // on either side, so that the two can be swapped.
  const used = new Set([plus.subCategoryId, minus.subCategoryId]);
  for (const subId of [plusSubCategoryId, minusSubCategoryId]) {
    await countedSubCategory(tx, bookId, subId, used.has(subId));
  }
  const bookCurrency = await bookCurrencyOf(tx, bookId);
  const minor = input.amount
    ? checked(() => parseAmount(input.amount!, bookCurrency)).minor
    : plus.amount;

  const [updated] = await tx
    .update(compensation)
    // Nothing of its own changes: its revision moves with its sides.
    .set({ updatedAt: new Date() })
    .where(rowOf(compensation, bookId, id, version))
    .returning({ id: compensation.id });
  if (!updated) return missing("Compensation", version);

  const shared = {
    date: input.date ?? plus.date,
    description: input.description ?? plus.description,
  };
  const write = (which: "plus" | "minus", values: object) =>
    tx
      .update(journalEntry)
      .set({ ...shared, ...values })
      .where(and(eq(journalEntry.compensationId, id), eq(journalEntry.compensationSide, which)));
  await write("plus", { ...side(minor), subCategoryId: plusSubCategoryId });
  await write("minus", { ...side(-minor), subCategoryId: minusSubCategoryId });
}

/**
 * Compensations of a book, mounted under /books/:bookId/compensations (see
 * docs/compensations.md): two journal entries without an account, created,
 * changed and deleted together. The journal lists them.
 */
export function compensationRoutes(db: Db) {
  return new Hono<AppEnv>()
    .get("/:id", async (c) => {
      const me = c.var.user.id;
      const bookId = idOf(c.req.param("bookId"));
      const id = idOf(c.req.param("id"), "Compensation");
      const result = await withUser(db, me, async (tx) => {
        await requireRole(tx, bookId, me, "viewer");
        return respond(tx, bookId, id);
      });
      return c.json(result);
    })

    .post("/", zValidator("json", compensationInputSchema), async (c) => {
      const me = c.var.user.id;
      const bookId = idOf(c.req.param("bookId"));
      const input = c.req.valid("json");
      const result = await withUser(db, me, async (tx) => {
        await requireRole(tx, bookId, me, "editor");
        return respond(tx, bookId, await createCompensation(tx, bookId, input));
      });
      return c.json(result, 201);
    })

    .patch("/:id", zValidator("json", compensationUpdateSchema), async (c) => {
      const me = c.var.user.id;
      const bookId = idOf(c.req.param("bookId"));
      const id = idOf(c.req.param("id"), "Compensation");
      const { version, ...input } = c.req.valid("json");
      const result = await withUser(db, me, async (tx) => {
        await requireRole(tx, bookId, me, "editor");
        await updateCompensation(tx, bookId, id, input, version);
        return respond(tx, bookId, id);
      });
      return c.json(result);
    })

    .delete("/:id", async (c) => {
      const me = c.var.user.id;
      const bookId = idOf(c.req.param("bookId"));
      const id = idOf(c.req.param("id"), "Compensation");
      await withUser(db, me, async (tx) => {
        await requireRole(tx, bookId, me, "editor");
        const deleted = await tx
          .delete(compensation)
          .where(rowOf(compensation, bookId, id))
          .returning({ id: compensation.id });
        if (deleted.length === 0) return missing("Compensation");
      });
      return c.body(null, 204);
    });
}

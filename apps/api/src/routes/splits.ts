import { zValidator } from "@hono/zod-validator";
import {
  bookAmount,
  parseAmount,
  resolveRate,
  splitInputSchema,
  splitUpdateSchema,
} from "@cash-scout/domain";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";
import { withUser, type Db, type Tx } from "../db/client.js";
import { journalEntry, split } from "../db/schema.js";
import type { AppEnv } from "../http.js";
import { checked, idOf, missing, requireRole, rowOf } from "./access.js";
import {
  accountOf,
  bookCurrencyOf,
  entryColumns,
  outEntry,
  refuseTransferSubCategory,
  splitsOf,
  subCategoryOf,
  usable,
} from "./journal.js";

type Input = z.output<typeof splitInputSchema> | z.output<typeof splitUpdateSchema>;
type Row = typeof journalEntry.$inferSelect;

async function respond(tx: Tx, bookId: string, id: string) {
  const [header] = await tx
    .select({ id: split.id, version: split.version })
    .from(split)
    .where(and(eq(split.id, id), eq(split.bookId, bookId)));
  const parts = (await splitsOf(tx, bookId, [id])).get(id);
  if (!header || !parts) {
    throw new HTTPException(404, { message: "Split not found" });
  }
  const bookCurrency = await bookCurrencyOf(tx, bookId);
  const [account] = await accountOf(tx, bookId, parts[0]!.accountId!);
  return {
    id: header.id,
    version: header.version,
    parts: parts.map((part) => outEntry(part, account!.currency, bookCurrency)),
  };
}

/**
 * Makes the parts of a split what `input` says. `current` are the entries it
 * already has; an entry left out is deleted. With a single part left, the split
 * goes and the entry is an ordinary one again.
 */
async function writeParts(tx: Tx, bookId: string, id: string, input: Input, current: Row[]) {
  const before = new Map(current.map((row) => [row.id, row]));
  // Items the split already uses stay allowed once archived.
  const account = await usable(
    accountOf(tx, bookId, input.accountId),
    "account",
    current.some((row) => row.accountId === input.accountId),
  );
  const bookCurrency = await bookCurrencyOf(tx, bookId);
  const rate = checked(() =>
    resolveRate(account.currency, bookCurrency, input.exchangeRate ?? current[0]?.exchangeRate),
  );
  const alone = input.parts.length === 1;
  const used = new Set(current.map((row) => row.subCategoryId));

  const kept = new Set(input.parts.flatMap((part) => (part.id ? [part.id] : [])));
  const gone = current.filter((row) => !kept.has(row.id)).map((row) => row.id);
  if (gone.length > 0) {
    await tx.delete(journalEntry).where(inArray(journalEntry.id, gone));
  }
  // One remainder at a time: it is taken from all before being given.
  await tx
    .update(journalEntry)
    .set({ splitRemainder: false })
    .where(and(eq(journalEntry.splitId, id), eq(journalEntry.splitRemainder, true)));

  const reconciled = input.reconciled ?? current[0]?.reconciled ?? false;
  const monthShifted = input.monthShifted ?? current[0]?.monthShifted ?? false;
  for (const part of input.parts) {
    const old = part.id ? before.get(part.id) : undefined;
    if (part.id && !old) {
      throw new HTTPException(400, { message: "Unknown part of the split" });
    }
    await usable(
      subCategoryOf(tx, bookId, part.subCategoryId),
      "sub-category",
      used.has(part.subCategoryId),
    );
    await refuseTransferSubCategory(tx, bookId, part.subCategoryId);
    const amount = checked(() => parseAmount(part.amount, account.currency));
    const values = {
      date: input.date,
      accountId: input.accountId,
      subCategoryId: part.subCategoryId,
      description: part.description,
      amount: amount.minor,
      exchangeRate: rate,
      bookAmount: checked(() => bookAmount(amount, rate, bookCurrency)).minor,
      reconciled,
      monthShifted,
      splitId: alone ? null : id,
      splitRemainder: !alone && part.remainder,
      ...(input.planned && { plannedAmount: amount.minor }),
    };
    if (old) {
      await tx.update(journalEntry).set(values).where(eq(journalEntry.id, old.id));
    } else {
      await tx.insert(journalEntry).values({ plannedAmount: 0n, bookId, ...values });
    }
  }
  if (alone) {
    await tx.delete(split).where(and(eq(split.id, id), eq(split.bookId, bookId)));
  }
}

/**
 * Creates a split and its parts; returns its id. One part may name an ordinary
 * entry, which is then split: it keeps its planned amount.
 */
export async function createSplit(
  tx: Tx,
  bookId: string,
  input: z.output<typeof splitInputSchema>,
) {
  const adopted = input.parts.flatMap((part) => (part.id ? [part.id] : []));
  const current =
    adopted.length === 0
      ? []
      : await tx
          .select()
          .from(journalEntry)
          .where(and(eq(journalEntry.bookId, bookId), inArray(journalEntry.id, adopted)));
  if (adopted.length > 1 || current.length !== adopted.length) {
    throw new HTTPException(400, { message: "A single entry of the book can be split" });
  }
  if (current.some((row) => row.splitId || row.transferId || row.compensationId)) {
    throw new HTTPException(400, { message: "This entry cannot be split" });
  }
  const [created] = await tx.insert(split).values({ bookId }).returning({ id: split.id });
  await writeParts(tx, bookId, created!.id, input, current);
  return created!.id;
}

/** Changes a split as a whole; returns whether it still is one. */
async function updateSplit(
  tx: Tx,
  bookId: string,
  id: string,
  { version, ...input }: z.output<typeof splitUpdateSchema>,
) {
  const current = await tx
    .select()
    .from(journalEntry)
    .where(and(eq(journalEntry.bookId, bookId), eq(journalEntry.splitId, id)));
  if (current.length === 0) {
    throw new HTTPException(404, { message: "Split not found" });
  }
  const [updated] = await tx
    .update(split)
    .set({ updatedAt: new Date() })
    .where(rowOf(split, bookId, id, version))
    .returning({ id: split.id });
  if (!updated) return missing("Split", version);
  await writeParts(tx, bookId, id, input, current);
  return input.parts.length > 1;
}

/**
 * What the planned entries of a category save: checks that none of the entries
 * changed since they were read, then deletes the removed ones. Removing a part
 * of a split removes the whole split.
 */
export async function removePlanned(
  tx: Tx,
  bookId: string,
  remove: readonly { id: string; version: number }[],
  update: readonly { id: string; version?: number }[],
) {
  const read = [...remove, ...update];
  if (read.length === 0) return;
  const rows = await tx
    .select(entryColumns)
    .from(journalEntry)
    .where(
      and(
        eq(journalEntry.bookId, bookId),
        inArray(
          journalEntry.id,
          read.map((entry) => entry.id),
        ),
      ),
    );
  const now = new Map(rows.map((row) => [row.id, row]));
  for (const { id, version } of read) {
    const row = now.get(id);
    if (!row || (version !== undefined && row.version !== version)) {
      return missing("Entry", version);
    }
  }
  for (const { id } of remove) {
    const row = now.get(id)!;
    if (row.transferId || row.compensationId) {
      throw new HTTPException(400, { message: "This entry is not changed on its own" });
    }
    if (row.splitId) {
      await tx.delete(split).where(and(eq(split.id, row.splitId), eq(split.bookId, bookId)));
    } else {
      await tx
        .delete(journalEntry)
        .where(and(eq(journalEntry.id, id), eq(journalEntry.bookId, bookId)));
    }
  }
}

/**
 * Splits of a book, mounted under /books/:bookId/splits (see docs/splits.md).
 * The journal lists their parts. Members read; editors and owners write.
 */
export function splitRoutes(db: Db) {
  return new Hono<AppEnv>()
    .get("/:id", async (c) => {
      const me = c.var.user.id;
      const bookId = idOf(c.req.param("bookId"));
      const id = idOf(c.req.param("id"), "Split");
      const result = await withUser(db, me, async (tx) => {
        await requireRole(tx, bookId, me, "viewer");
        return respond(tx, bookId, id);
      });
      return c.json(result);
    })

    .post("/", zValidator("json", splitInputSchema), async (c) => {
      const me = c.var.user.id;
      const bookId = idOf(c.req.param("bookId"));
      const input = c.req.valid("json");
      const result = await withUser(db, me, async (tx) => {
        await requireRole(tx, bookId, me, "editor");
        return respond(tx, bookId, await createSplit(tx, bookId, input));
      });
      return c.json(result, 201);
    })

    .patch("/:id", zValidator("json", splitUpdateSchema), async (c) => {
      const me = c.var.user.id;
      const bookId = idOf(c.req.param("bookId"));
      const id = idOf(c.req.param("id"), "Split");
      const input = c.req.valid("json");
      const result = await withUser(db, me, async (tx) => {
        await requireRole(tx, bookId, me, "editor");
        // Null once a single entry is left: there is no split to answer with.
        return (await updateSplit(tx, bookId, id, input)) ? respond(tx, bookId, id) : null;
      });
      return c.json(result);
    })

    .delete("/:id", async (c) => {
      const me = c.var.user.id;
      const bookId = idOf(c.req.param("bookId"));
      const id = idOf(c.req.param("id"), "Split");
      await withUser(db, me, async (tx) => {
        await requireRole(tx, bookId, me, "editor");
        const deleted = await tx
          .delete(split)
          .where(rowOf(split, bookId, id))
          .returning({ id: split.id });
        if (deleted.length === 0) return missing("Split");
      });
      return c.body(null, 204);
    });
}

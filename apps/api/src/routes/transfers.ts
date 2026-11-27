import { zValidator } from "@hono/zod-validator";
import {
  addDays,
  bookAmount,
  budgetQuerySchema,
  money,
  parseAmount,
  resolveRate,
  transferInputSchema,
  transferPlanSchema,
  transferUpdateSchema,
} from "@cash-scout/domain";
import { and, asc, between, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";
import { withUser, type Db, type Tx } from "../db/client.js";
import {
  bookAccount,
  category,
  journalEntry,
  nature,
  subCategory,
  transfer,
} from "../db/schema.js";
import type { AppEnv } from "../http.js";
import { checked, idOf, missing, requireRole, rowOf } from "./access.js";
import { accountOf, bookCurrencyOf, entryColumns, outEntry, usable } from "./journal.js";

/** A sub-category of the book, which must belong to a category of a transfer nature. */
async function transferSubCategory(tx: Tx, bookId: string, id: string, allowArchived: boolean) {
  const [row] = await tx
    .select({ archivedAt: subCategory.archivedAt, transfer: nature.transfer })
    .from(subCategory)
    .innerJoin(category, eq(category.id, subCategory.categoryId))
    .innerJoin(nature, eq(nature.id, category.natureId))
    .where(and(eq(subCategory.id, id), eq(subCategory.bookId, bookId)));
  const found = await usable(Promise.resolve(row ? [row] : []), "sub-category", allowArchived);
  if (!found.transfer) {
    throw new HTTPException(400, {
      message: "A transfer needs a sub-category of a transfer category",
    });
  }
}

const abs = (value: bigint) => (value < 0n ? -value : value);

/** Both sides of a transfer, as the API returns them. */
async function readTransfer(tx: Tx, bookId: string, id: string) {
  const [header] = await tx
    .select({ id: transfer.id, version: transfer.version, delayDays: transfer.delayDays })
    .from(transfer)
    .where(and(eq(transfer.id, id), eq(transfer.bookId, bookId)));
  if (!header) {
    throw new HTTPException(404, { message: "Transfer not found" });
  }
  const rows = await tx
    .select({ ...entryColumns, currency: bookAccount.currency })
    .from(journalEntry)
    .innerJoin(bookAccount, eq(bookAccount.id, journalEntry.accountId))
    .where(and(eq(journalEntry.transferId, id), eq(journalEntry.bookId, bookId)));
  const source = rows.find((row) => row.transferLeg === "source");
  const destination = rows.find((row) => row.transferLeg === "destination");
  if (!source || !destination) {
    throw new HTTPException(500, { message: "A transfer lost one of its sides" });
  }
  return { header, source, destination };
}

async function respond(tx: Tx, bookId: string, id: string) {
  const [{ header, source, destination }, bookCurrency] = await Promise.all([
    readTransfer(tx, bookId, id),
    bookCurrencyOf(tx, bookId),
  ]);
  return {
    id: header.id,
    version: header.version,
    delayDays: header.delayDays,
    source: outEntry(source, source.currency, bookCurrency),
    destination: outEntry(destination, destination.currency, bookCurrency),
  };
}

/** Creates a transfer and its two entries; returns its id. */
async function createTransfer(tx: Tx, bookId: string, input: z.output<typeof transferInputSchema>) {
  const source = await usable(accountOf(tx, bookId, input.sourceAccountId), "account");
  const destination = await usable(accountOf(tx, bookId, input.destinationAccountId), "account");
  await transferSubCategory(tx, bookId, input.subCategoryId, false);
  const bookCurrency = await bookCurrencyOf(tx, bookId);
  const sameCurrency = source.currency === destination.currency;
  if (!sameCurrency && input.destinationAmount === undefined) {
    throw new HTTPException(400, {
      message: "The accounts are in different currencies: give the destination amount",
    });
  }
  const out = checked(() => parseAmount(input.amount, source.currency));
  const into = checked(() =>
    parseAmount(sameCurrency ? input.amount : input.destinationAmount!, destination.currency),
  );
  const sourceRate = checked(() => resolveRate(source.currency, bookCurrency, input.sourceRate));
  const destinationRate = checked(() =>
    resolveRate(destination.currency, bookCurrency, input.destinationRate),
  );
  const [created] = await tx
    .insert(transfer)
    .values({ bookId, delayDays: input.delayDays })
    .returning({ id: transfer.id });
  const shared = {
    bookId,
    transferId: created!.id,
    subCategoryId: input.subCategoryId,
    description: input.description,
  };
  const side = (minor: bigint, currency: string, rate: string) => ({
    amount: minor,
    plannedAmount: input.planned ? minor : 0n,
    exchangeRate: rate,
    bookAmount: checked(() => bookAmount(money(minor, currency), rate, bookCurrency)).minor,
  });
  await tx.insert(journalEntry).values([
    {
      ...shared,
      transferLeg: "source" as const,
      date: input.date,
      accountId: input.sourceAccountId,
      ...side(-out.minor, source.currency, sourceRate),
    },
    {
      ...shared,
      transferLeg: "destination" as const,
      date: addDays(input.date, input.delayDays),
      accountId: input.destinationAccountId,
      ...side(into.minor, destination.currency, destinationRate),
    },
  ]);
  return created!.id;
}

/** Changes both sides of a transfer; with `version`, only if nobody changed it since. */
async function updateTransfer(
  tx: Tx,
  bookId: string,
  id: string,
  input: Omit<z.output<typeof transferUpdateSchema>, "version">,
  version?: number,
) {
  const { header, source, destination } = await readTransfer(tx, bookId, id);
  if (input.planned && (source.reconciled || destination.reconciled)) {
    throw new HTTPException(400, {
      message: "The plan of a reconciled transfer does not change",
    });
  }
  const sourceAccountId = input.sourceAccountId ?? source.accountId;
  const destinationAccountId = input.destinationAccountId ?? destination.accountId;
  if (sourceAccountId === destinationAccountId) {
    throw new HTTPException(400, { message: "A transfer needs two different accounts" });
  }
  // As for an entry: an account the transfer already uses stays allowed once archived,
  // and a side only moves to an account in the same currency.
  for (const [side, accountId] of [
    [source, sourceAccountId],
    [destination, destinationAccountId],
  ] as const) {
    if (accountId === side.accountId) continue;
    const account = await usable(accountOf(tx, bookId, accountId), "account");
    if (account.currency !== side.currency) {
      throw new HTTPException(400, {
        message: "A transfer cannot move to an account in another currency",
      });
    }
  }
  const subCategoryId = input.subCategoryId ?? source.subCategoryId;
  await transferSubCategory(tx, bookId, subCategoryId, subCategoryId === source.subCategoryId);
  const bookCurrency = await bookCurrencyOf(tx, bookId);
  const sameCurrency = source.currency === destination.currency;
  const outMinor = input.amount
    ? checked(() => parseAmount(input.amount!, source.currency)).minor
    : abs(source.amount);
  const intoMinor = sameCurrency
    ? outMinor
    : input.destinationAmount
      ? checked(() => parseAmount(input.destinationAmount!, destination.currency)).minor
      : abs(destination.amount);
  const sourceRate = checked(() =>
    resolveRate(source.currency, bookCurrency, input.sourceRate ?? source.exchangeRate),
  );
  const destinationRate = checked(() =>
    resolveRate(
      destination.currency,
      bookCurrency,
      input.destinationRate ?? destination.exchangeRate,
    ),
  );
  const delayDays = input.delayDays ?? header.delayDays;
  const date = input.date ?? source.date;

  const [updated] = await tx
    .update(transfer)
    .set({ delayDays })
    .where(rowOf(transfer, bookId, id, version))
    .returning({ id: transfer.id });
  if (!updated) return missing("Transfer", version);

  const shared = {
    subCategoryId,
    description: input.description ?? source.description,
  };
  const side = (minor: bigint, currency: string, rate: string) => ({
    amount: minor,
    plannedAmount: input.planned ? minor : undefined,
    exchangeRate: rate,
    bookAmount: checked(() => bookAmount(money(minor, currency), rate, bookCurrency)).minor,
  });
  const write = (leg: "source" | "destination", values: object) =>
    tx
      .update(journalEntry)
      .set(values)
      .where(and(eq(journalEntry.transferId, id), eq(journalEntry.transferLeg, leg)));
  await write("source", {
    ...shared,
    date,
    accountId: sourceAccountId,
    ...side(-outMinor, source.currency, sourceRate),
  });
  await write("destination", {
    ...shared,
    date: addDays(date, delayDays),
    accountId: destinationAccountId,
    ...side(intoMinor, destination.currency, destinationRate),
  });
}

/** Deletes a transfer, its two entries with it; with `version`, only if unchanged. */
async function deleteTransfer(tx: Tx, bookId: string, id: string, version?: number) {
  const deleted = await tx
    .delete(transfer)
    .where(rowOf(transfer, bookId, id, version))
    .returning({ id: transfer.id });
  if (deleted.length === 0) return missing("Transfer", version);
}

/** The transfers leaving their source account in the year, in date order. */
async function transfersOf(tx: Tx, bookId: string, year: number) {
  const leaving = tx
    .select({ id: journalEntry.transferId })
    .from(journalEntry)
    .where(
      and(
        eq(journalEntry.bookId, bookId),
        eq(journalEntry.transferLeg, "source"),
        between(journalEntry.date, `${year}-01-01`, `${year}-12-31`),
      ),
    );
  const rows = await tx
    .select({ ...entryColumns, currency: bookAccount.currency })
    .from(journalEntry)
    .innerJoin(bookAccount, eq(bookAccount.id, journalEntry.accountId))
    .where(and(eq(journalEntry.bookId, bookId), inArray(journalEntry.transferId, leaving)))
    .orderBy(asc(journalEntry.date), asc(journalEntry.transferId));
  const headers = new Map(
    (
      await tx
        .select({ id: transfer.id, version: transfer.version, delayDays: transfer.delayDays })
        .from(transfer)
        .where(
          inArray(
            transfer.id,
            rows.flatMap((row) => (row.transferId ? [row.transferId] : [])),
          ),
        )
    ).map((header) => [header.id, header]),
  );
  const bookCurrency = await bookCurrencyOf(tx, bookId);
  const destinations = new Map(
    rows.filter((row) => row.transferLeg === "destination").map((row) => [row.transferId, row]),
  );
  const out = (side: (typeof rows)[number]) => outEntry(side, side.currency, bookCurrency);
  return rows.flatMap((row) => {
    const destination = destinations.get(row.transferId);
    const header = headers.get(row.transferId ?? "");
    if (row.transferLeg !== "source" || !destination || !header) return [];
    return [
      {
        id: header.id,
        version: header.version,
        delayDays: header.delayDays,
        source: out(row),
        destination: out(destination),
      },
    ];
  });
}

/**
 * Transfers between two accounts of a book, mounted under
 * /books/:bookId/transfers. A transfer is two journal entries (a negative
 * source, a positive destination) that are created, changed and deleted
 * together. Each side is reconciled on its own, through the journal.
 */
export function transferRoutes(db: Db) {
  return (
    new Hono<AppEnv>()
      // The sub-category most used by the book's transfers, to start a new one
      // from. Archived ones are left out.
      .get("/defaults", async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const result = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "viewer");
          const sides = and(
            eq(journalEntry.bookId, bookId),
            eq(journalEntry.transferLeg, "source"),
          );
          const [sub] = await tx
            .select({ id: journalEntry.subCategoryId })
            .from(journalEntry)
            .innerJoin(subCategory, eq(subCategory.id, journalEntry.subCategoryId))
            .where(and(sides, isNull(subCategory.archivedAt)))
            .groupBy(journalEntry.subCategoryId)
            .orderBy(desc(count()), journalEntry.subCategoryId)
            .limit(1);
          return { subCategoryId: sub?.id ?? null };
        });
        return c.json(result);
      })

      .get("/:id", async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Transfer");
        const result = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "viewer");
          return respond(tx, bookId, id);
        });
        return c.json(result);
      })

      // The transfers of a year, by the date they leave their source account.
      .get("/", zValidator("query", budgetQuerySchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const { year } = c.req.valid("query");
        const result = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "viewer");
          return transfersOf(tx, bookId, year);
        });
        return c.json(result);
      })

      // The planned transfers edited in the budget, saved together, all or nothing.
      .post("/plan", zValidator("json", transferPlanSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const { create, update, remove } = c.req.valid("json");
        await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          for (const { id, version } of remove) {
            const [reconciled] = await tx
              .select({ id: journalEntry.id })
              .from(journalEntry)
              .where(
                and(
                  eq(journalEntry.bookId, bookId),
                  eq(journalEntry.transferId, id),
                  eq(journalEntry.reconciled, true),
                ),
              )
              .limit(1);
            if (reconciled) {
              throw new HTTPException(400, {
                message: "The plan of a reconciled transfer does not change",
              });
            }
            await deleteTransfer(tx, bookId, id, version);
          }
          for (const { id, version, ...change } of update) {
            await updateTransfer(tx, bookId, id, change, version);
          }
          for (const input of create) {
            await createTransfer(tx, bookId, { ...input, planned: true });
          }
        });
        return c.body(null, 204);
      })

      .post("/", zValidator("json", transferInputSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const input = c.req.valid("json");
        const result = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          return respond(tx, bookId, await createTransfer(tx, bookId, input));
        });
        return c.json(result, 201);
      })

      .patch("/:id", zValidator("json", transferUpdateSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Transfer");
        const { version, ...input } = c.req.valid("json");
        const result = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          await updateTransfer(tx, bookId, id, input, version);
          return respond(tx, bookId, id);
        });
        return c.json(result);
      })

      .delete("/:id", async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Transfer");
        await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          await deleteTransfer(tx, bookId, id);
        });
        return c.body(null, 204);
      })
  );
}

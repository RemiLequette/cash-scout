import { zValidator } from "@hono/zod-validator";
import {
  addDays,
  bookAmount,
  money,
  parseAmount,
  resolveRate,
  transferInputSchema,
  transferUpdateSchema,
} from "@cash-scout/domain";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { withUser, type Db, type Tx } from "../db/client.js";
import { bookAccount, category, journalEntry, subCategory, transfer } from "../db/schema.js";
import type { AppEnv } from "../http.js";
import { checked, idOf, missing, requireRole, rowOf } from "./access.js";
import {
  accountOf,
  bookCurrencyOf,
  entryColumns,
  outEntry,
  paymentTypeOf,
  usable,
} from "./journal.js";

/** A sub-category of the book, which must belong to a category of the transfer direction. */
async function transferSubCategory(tx: Tx, bookId: string, id: string, allowArchived: boolean) {
  const [row] = await tx
    .select({ archivedAt: subCategory.archivedAt, direction: category.direction })
    .from(subCategory)
    .innerJoin(category, eq(category.id, subCategory.categoryId))
    .where(and(eq(subCategory.id, id), eq(subCategory.bookId, bookId)));
  const found = await usable(Promise.resolve(row ? [row] : []), "sub-category", allowArchived);
  if (found.direction !== "transfer") {
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

/**
 * Transfers between two accounts of a book, mounted under
 * /books/:bookId/transfers. A transfer is two journal entries (a negative
 * source, a positive destination) that are created, changed and deleted
 * together. Each side is reconciled on its own, through the journal.
 */
export function transferRoutes(db: Db) {
  return new Hono<AppEnv>()
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

    .post("/", zValidator("json", transferInputSchema), async (c) => {
      const me = c.var.user.id;
      const bookId = idOf(c.req.param("bookId"));
      const input = c.req.valid("json");
      const result = await withUser(db, me, async (tx) => {
        await requireRole(tx, bookId, me, "editor");
        const source = await usable(accountOf(tx, bookId, input.sourceAccountId), "account");
        const destination = await usable(
          accountOf(tx, bookId, input.destinationAccountId),
          "account",
        );
        await transferSubCategory(tx, bookId, input.subCategoryId, false);
        if (input.paymentTypeId) {
          await usable(paymentTypeOf(tx, bookId, input.paymentTypeId), "payment type");
        }
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
        const sourceRate = checked(() =>
          resolveRate(source.currency, bookCurrency, input.sourceRate),
        );
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
          paymentTypeId: input.paymentTypeId ?? null,
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
        return respond(tx, bookId, created!.id);
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
        const { header, source, destination } = await readTransfer(tx, bookId, id);
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
        await transferSubCategory(
          tx,
          bookId,
          subCategoryId,
          subCategoryId === source.subCategoryId,
        );
        const paymentTypeId =
          input.paymentTypeId === undefined ? source.paymentTypeId : input.paymentTypeId;
        if (paymentTypeId && paymentTypeId !== source.paymentTypeId) {
          await usable(paymentTypeOf(tx, bookId, paymentTypeId), "payment type");
        }
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
          paymentTypeId,
        };
        const side = (minor: bigint, currency: string, rate: string) => ({
          amount: minor,
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
        // Its two entries go with it.
        const deleted = await tx
          .delete(transfer)
          .where(and(eq(transfer.id, id), eq(transfer.bookId, bookId)))
          .returning({ id: transfer.id });
        if (deleted.length === 0) {
          throw new HTTPException(404, { message: "Transfer not found" });
        }
      });
      return c.body(null, 204);
    });
}

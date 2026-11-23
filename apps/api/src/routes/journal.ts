import { zValidator } from "@hono/zod-validator";
import {
  bookAmount,
  entryInputSchema,
  entryUpdateSchema,
  journalQuerySchema,
  money,
  parseAmount,
  projectionQuerySchema,
  reconcileSchema,
  resolveRate,
  toDecimalString,
} from "@cash-scout/domain";
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { withUser, type Db, type Tx } from "../db/client.js";
import { book, bookAccount, journalEntry, paymentType, subCategory } from "../db/schema.js";
import type { AppEnv } from "../http.js";
import { checked, idOf, missing, requireRole, rowOf } from "./access.js";
import { monthEnds } from "./budget-months.js";

async function bookCurrencyOf(tx: Tx, bookId: string): Promise<string> {
  const [row] = await tx.select({ currency: book.currency }).from(book).where(eq(book.id, bookId));
  if (!row) {
    throw new HTTPException(404, { message: "Book not found" });
  }
  return row.currency;
}

/**
 * An account, sub-category or payment type of the book, for an entry.
 * Archived items are refused, unless the entry already uses the item.
 */
async function usable<T extends { archivedAt: Date | null }>(
  rows: Promise<T[]>,
  what: string,
  allowArchived = false,
): Promise<T> {
  const [row] = await rows;
  if (!row) {
    throw new HTTPException(400, { message: `Unknown ${what}` });
  }
  if (row.archivedAt && !allowArchived) {
    throw new HTTPException(400, { message: `The ${what} is archived` });
  }
  return row;
}

function accountOf(tx: Tx, bookId: string, id: string) {
  return tx
    .select({ currency: bookAccount.currency, archivedAt: bookAccount.archivedAt })
    .from(bookAccount)
    .where(and(eq(bookAccount.id, id), eq(bookAccount.bookId, bookId)));
}
function subCategoryOf(tx: Tx, bookId: string, id: string) {
  return tx
    .select({ archivedAt: subCategory.archivedAt })
    .from(subCategory)
    .where(and(eq(subCategory.id, id), eq(subCategory.bookId, bookId)));
}
function paymentTypeOf(tx: Tx, bookId: string, id: string) {
  return tx
    .select({ archivedAt: paymentType.archivedAt })
    .from(paymentType)
    .where(and(eq(paymentType.id, id), eq(paymentType.bookId, bookId)));
}

function originalOf(amount: string | null | undefined, currency: string | null | undefined) {
  if (amount == null || currency == null) {
    return { originalAmount: null, originalCurrency: null };
  }
  return {
    originalAmount: checked(() => parseAmount(amount, currency).minor),
    originalCurrency: currency,
  };
}

const entryColumns = {
  version: journalEntry.version,
  id: journalEntry.id,
  date: journalEntry.date,
  accountId: journalEntry.accountId,
  subCategoryId: journalEntry.subCategoryId,
  description: journalEntry.description,
  paymentTypeId: journalEntry.paymentTypeId,
  amount: journalEntry.amount,
  plannedAmount: journalEntry.plannedAmount,
  exchangeRate: journalEntry.exchangeRate,
  bookAmount: journalEntry.bookAmount,
  originalAmount: journalEntry.originalAmount,
  originalCurrency: journalEntry.originalCurrency,
  reconciled: journalEntry.reconciled,
  scheduleId: journalEntry.scheduleId,
  linkId: journalEntry.linkId,
  createdAt: journalEntry.createdAt,
  updatedAt: journalEntry.updatedAt,
};
type EntryRow = Omit<typeof journalEntry.$inferSelect, "bookId">;

/** Shapes an entry for JSON: amounts as decimal text in their currency. */
function outEntry(row: EntryRow, currency: string, bookCurrency: string) {
  const text = (minor: bigint, cur: string) => toDecimalString(money(minor, cur));
  return {
    ...row,
    currency,
    amount: text(row.amount, currency),
    plannedAmount: text(row.plannedAmount, currency),
    variance: text(row.amount - row.plannedAmount, currency),
    bookAmount: text(row.bookAmount, bookCurrency),
    originalAmount:
      row.originalAmount === null || row.originalCurrency === null
        ? null
        : text(row.originalAmount, row.originalCurrency),
  };
}

/**
 * The journal of a book, mounted under /books/:bookId/journal.
 * Members read; editors and owners write.
 */
export function journalRoutes(db: Db) {
  return (
    new Hono<AppEnv>()
      .get("/", zValidator("query", journalQuerySchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const query = c.req.valid("query");
        const result = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "viewer");
          const filters: SQL[] = [eq(journalEntry.bookId, bookId)];
          if (query.from) filters.push(gte(journalEntry.date, query.from));
          if (query.to) filters.push(lte(journalEntry.date, query.to));
          if (query.accountId) filters.push(eq(journalEntry.accountId, query.accountId));
          if (query.subCategoryId) {
            filters.push(eq(journalEntry.subCategoryId, query.subCategoryId));
          }
          if (query.months) {
            filters.push(
              query.months.length > 0
                ? inArray(sql`to_char(${journalEntry.date}, 'YYYY-MM')`, query.months)
                : sql`false`,
            );
          }
          if (query.subCategoryIds) {
            filters.push(
              query.subCategoryIds.length > 0
                ? inArray(journalEntry.subCategoryId, query.subCategoryIds)
                : sql`false`,
            );
          }
          if (query.categoryId) {
            filters.push(
              inArray(
                journalEntry.subCategoryId,
                tx
                  .select({ id: subCategory.id })
                  .from(subCategory)
                  .where(
                    and(
                      eq(subCategory.bookId, bookId),
                      eq(subCategory.categoryId, query.categoryId),
                    ),
                  ),
              ),
            );
          }
          if (query.reconciled) {
            filters.push(eq(journalEntry.reconciled, query.reconciled === "true"));
          }
          if (query.q) {
            const pattern = `%${query.q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
            filters.push(ilike(journalEntry.description, pattern));
          }
          const where = and(...filters);
          const [rows, [total], bookCurrency] = await Promise.all([
            tx
              .select({ ...entryColumns, currency: bookAccount.currency })
              .from(journalEntry)
              .innerJoin(bookAccount, eq(bookAccount.id, journalEntry.accountId))
              .where(where)
              .orderBy(desc(journalEntry.date), desc(journalEntry.createdAt), asc(journalEntry.id))
              .limit(query.limit)
              .offset(query.offset),
            tx.select({ n: count() }).from(journalEntry).where(where),
            bookCurrencyOf(tx, bookId),
          ]);
          return {
            total: total?.n ?? 0,
            bookCurrency,
            entries: rows.map(({ currency, ...row }) => outEntry(row, currency, bookCurrency)),
          };
        });
        return c.json(result);
      })

      // The descriptions most used in the last 12 months, each with its latest
      // entry, to start a new entry from. Descriptions found on a forecast are
      // left out: those are planned, not typed.
      .get("/frequent", async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const key = sql<string>`lower(btrim(${journalEntry.description}))`;
        const result = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "viewer");
          const forecasts = tx
            .select({ key })
            .from(journalEntry)
            .where(and(eq(journalEntry.bookId, bookId), eq(journalEntry.reconciled, false)));
          const top = await tx
            .select({ key, uses: count() })
            .from(journalEntry)
            .where(
              and(
                eq(journalEntry.bookId, bookId),
                eq(journalEntry.reconciled, true),
                sql`${key} <> ''`,
                gte(journalEntry.date, sql`current_date - interval '12 months'`),
                sql`${key} not in (${forecasts})`,
              ),
            )
            .groupBy(key)
            .orderBy(desc(count()), key)
            .limit(10);
          if (top.length === 0) return [];
          const [latest, bookCurrency] = await Promise.all([
            tx
              .selectDistinctOn([key], { ...entryColumns, key, currency: bookAccount.currency })
              .from(journalEntry)
              .innerJoin(bookAccount, eq(bookAccount.id, journalEntry.accountId))
              .where(
                and(
                  eq(journalEntry.bookId, bookId),
                  eq(journalEntry.reconciled, true),
                  inArray(
                    key,
                    top.map((row) => row.key),
                  ),
                ),
              )
              .orderBy(key, desc(journalEntry.date), desc(journalEntry.createdAt)),
            bookCurrencyOf(tx, bookId),
          ]);
          const byKey = new Map(
            latest.map(({ key: k, currency, ...row }) => [k, { currency, row }]),
          );
          return top.flatMap(({ key: k, uses }) => {
            const found = byKey.get(k);
            return found
              ? [{ uses, entry: outEntry(found.row, found.currency, bookCurrency) }]
              : [];
          });
        });
        return c.json(result);
      })

      // The months holding entries, with their number, for the period picker.
      .get("/months", async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const month = sql<string>`to_char(${journalEntry.date}, 'YYYY-MM')`;
        const rows = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "viewer");
          return tx
            .select({ month, entries: count() })
            .from(journalEntry)
            .where(eq(journalEntry.bookId, bookId))
            .groupBy(month)
            .orderBy(month);
        });
        return c.json(rows);
      })

      .get("/balances", async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const rows = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "viewer");
          return tx
            .select({
              accountId: bookAccount.id,
              currency: bookAccount.currency,
              reconciled: sql<string>`coalesce(sum(${journalEntry.amount}) filter (where ${journalEntry.reconciled}), 0)`,
              total: sql<string>`coalesce(sum(${journalEntry.amount}), 0)`,
            })
            .from(bookAccount)
            .leftJoin(journalEntry, eq(journalEntry.accountId, bookAccount.id))
            .where(eq(bookAccount.bookId, bookId))
            .groupBy(bookAccount.id, bookAccount.currency);
        });
        return c.json(
          rows.map((row) => ({
            accountId: row.accountId,
            currency: row.currency,
            reconciled: toDecimalString(money(BigInt(row.reconciled), row.currency)),
            total: toDecimalString(money(BigInt(row.total), row.currency)),
          })),
        );
      })

      // The daily balance of every account over a window, whatever the journal's
      // filters: the opening balance on its first day, then what changes it day
      // by day. Entries count reconciled or not; the month-end lines of unused
      // budgets count while their month has not passed, and settled ones are 0.
      .get("/projection", zValidator("query", projectionQuerySchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const { from, to, today } = c.req.valid("query");
        const result = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "viewer");
          const bookCurrency = await bookCurrencyOf(tx, bookId);
          const years = Array.from(
            { length: Math.max(0, Number(to.slice(0, 4)) - Number(from.slice(0, 4)) + 1) },
            (_, i) => Number(from.slice(0, 4)) + i,
          );
          const [accounts, opening, days, lines] = await Promise.all([
            tx
              .select({
                id: bookAccount.id,
                currency: bookAccount.currency,
                archived: sql<boolean>`${bookAccount.archivedAt} is not null`,
              })
              .from(bookAccount)
              .where(eq(bookAccount.bookId, bookId)),
            tx
              .select({
                accountId: journalEntry.accountId,
                total: sql<string>`sum(${journalEntry.amount})`,
              })
              .from(journalEntry)
              .where(and(eq(journalEntry.bookId, bookId), sql`${journalEntry.date} < ${from}`))
              .groupBy(journalEntry.accountId),
            tx
              .select({
                accountId: journalEntry.accountId,
                date: journalEntry.date,
                total: sql<string>`sum(${journalEntry.amount})`,
              })
              .from(journalEntry)
              .where(
                and(
                  eq(journalEntry.bookId, bookId),
                  gte(journalEntry.date, from),
                  lte(journalEntry.date, to),
                ),
              )
              .groupBy(journalEntry.accountId, journalEntry.date)
              .orderBy(asc(journalEntry.date)),
            Promise.all(years.map((year) => monthEnds(tx, bookId, bookCurrency, year))),
          ]);
          const minor = (text: string | undefined, currency: string) =>
            toDecimalString(money(BigInt(text ?? "0"), currency));
          const openingOf = new Map(opening.map((row) => [row.accountId, row.total]));
          const changes = new Map<string, Map<string, bigint>>();
          const addChange = (accountId: string, date: string, amount: bigint) => {
            const byDate = changes.get(accountId) ?? new Map<string, bigint>();
            byDate.set(date, (byDate.get(date) ?? 0n) + amount);
            changes.set(accountId, byDate);
          };
          const currencyOf = new Map(accounts.map((a) => [a.id, a.currency]));
          for (const day of days) addChange(day.accountId, day.date, BigInt(day.total));
          for (const line of lines.flat()) {
            if (line.date < from || line.date > to) continue;
            if (line.date.slice(0, 7) < today.slice(0, 7)) continue;
            addChange(
              line.accountId,
              line.date,
              parseAmount(line.amount, currencyOf.get(line.accountId)!).minor,
            );
          }
          return accounts.map(({ id, currency, archived }) => ({
            accountId: id,
            currency,
            archived,
            opening: minor(openingOf.get(id), currency),
            changes: [...(changes.get(id) ?? [])]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([date, amount]) => ({
                date,
                amount: toDecimalString(money(amount, currency)),
              })),
          }));
        });
        return c.json(result);
      })

      .post("/", zValidator("json", entryInputSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const input = c.req.valid("json");
        const entry = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const account = await usable(accountOf(tx, bookId, input.accountId), "account");
          await usable(subCategoryOf(tx, bookId, input.subCategoryId), "sub-category");
          if (input.paymentTypeId) {
            await usable(paymentTypeOf(tx, bookId, input.paymentTypeId), "payment type");
          }
          const bookCurrency = await bookCurrencyOf(tx, bookId);
          const amount = checked(() => parseAmount(input.amount, account.currency));
          const rate = checked(() =>
            resolveRate(account.currency, bookCurrency, input.exchangeRate),
          );
          const [created] = await tx
            .insert(journalEntry)
            .values({
              bookId,
              date: input.date,
              accountId: input.accountId,
              subCategoryId: input.subCategoryId,
              description: input.description,
              paymentTypeId: input.paymentTypeId ?? null,
              amount: amount.minor,
              plannedAmount: input.planned ? amount.minor : 0n,
              exchangeRate: rate,
              bookAmount: checked(() => bookAmount(amount, rate, bookCurrency)).minor,
              ...originalOf(input.originalAmount, input.originalCurrency),
              reconciled: input.reconciled ?? false,
            })
            .returning(entryColumns);
          return outEntry(created!, account.currency, bookCurrency);
        });
        return c.json(entry, 201);
      })

      .post("/reconcile", zValidator("json", reconcileSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const { ids, reconciled } = c.req.valid("json");
        const updated = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          return tx
            .update(journalEntry)
            .set({ reconciled })
            .where(and(eq(journalEntry.bookId, bookId), inArray(journalEntry.id, ids)))
            .returning({ id: journalEntry.id });
        });
        return c.json({ updated: updated.length });
      })

      .patch("/:id", zValidator("json", entryUpdateSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Entry");
        const { version, ...input } = c.req.valid("json");
        const entry = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const [current] = await tx
            .select({ ...entryColumns, currency: bookAccount.currency })
            .from(journalEntry)
            .innerJoin(bookAccount, eq(bookAccount.id, journalEntry.accountId))
            .where(and(eq(journalEntry.id, id), eq(journalEntry.bookId, bookId)));
          if (!current) {
            throw new HTTPException(404, { message: "Entry not found" });
          }
          // Items the entry already uses stay allowed even once archived.
          if (input.accountId && input.accountId !== current.accountId) {
            const account = await usable(accountOf(tx, bookId, input.accountId), "account");
            if (account.currency !== current.currency) {
              throw new HTTPException(400, {
                message: "An entry cannot move to an account in another currency",
              });
            }
          }
          if (input.subCategoryId && input.subCategoryId !== current.subCategoryId) {
            await usable(subCategoryOf(tx, bookId, input.subCategoryId), "sub-category");
          }
          if (input.paymentTypeId && input.paymentTypeId !== current.paymentTypeId) {
            await usable(paymentTypeOf(tx, bookId, input.paymentTypeId), "payment type");
          }
          const bookCurrency = await bookCurrencyOf(tx, bookId);
          const amount =
            input.amount === undefined
              ? money(current.amount, current.currency)
              : checked(() => parseAmount(input.amount!, current.currency));
          const rate = checked(() =>
            resolveRate(current.currency, bookCurrency, input.exchangeRate ?? current.exchangeRate),
          );
          const [updated] = await tx
            .update(journalEntry)
            .set({
              date: input.date,
              accountId: input.accountId,
              subCategoryId: input.subCategoryId,
              description: input.description,
              paymentTypeId: input.paymentTypeId,
              reconciled: input.reconciled,
              amount: amount.minor,
              exchangeRate: rate,
              bookAmount: checked(() => bookAmount(amount, rate, bookCurrency)).minor,
              ...(input.originalAmount !== undefined || input.originalCurrency !== undefined
                ? originalOf(input.originalAmount, input.originalCurrency)
                : {}),
            })
            .where(rowOf(journalEntry, bookId, id, version))
            .returning(entryColumns);
          if (!updated) return missing("Entry", version);
          return outEntry(updated, current.currency, bookCurrency);
        });
        return c.json(entry);
      })

      .delete("/:id", async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Entry");
        await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const deleted = await tx
            .delete(journalEntry)
            .where(and(eq(journalEntry.id, id), eq(journalEntry.bookId, bookId)))
            .returning({ id: journalEntry.id });
          if (deleted.length === 0) {
            throw new HTTPException(404, { message: "Entry not found" });
          }
        });
        return c.body(null, 204);
      })
  );
}

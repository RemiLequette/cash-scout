import { zValidator } from "@hono/zod-validator";
import {
  bookAmount,
  budgetMonth,
  entryInputSchema,
  entryUpdateSchema,
  journalQuerySchema,
  money,
  parseAmount,
  projectionQuerySchema,
  reconcileSchema,
  resolveRate,
  shiftToKeep,
  toDecimalString,
} from "@cash-scout/domain";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { Hono } from "hono";
import type { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { BUDGET_DATE } from "../db/budget-date.js";
import { withUser, type Db, type Tx } from "../db/client.js";
import {
  book,
  bookAccount,
  category,
  journalEntry,
  nature,
  split,
  subCategory,
} from "../db/schema.js";
import type { AppEnv } from "../http.js";
import { checked, idOf, missing, requireRole, rowOf } from "./access.js";
import { monthEnds } from "./budget-months.js";

export async function bookCurrencyOf(tx: Tx, bookId: string): Promise<string> {
  const [row] = await tx.select({ currency: book.currency }).from(book).where(eq(book.id, bookId));
  if (!row) {
    throw new HTTPException(404, { message: "Book not found" });
  }
  return row.currency;
}

/**
 * An account or sub-category of the book, for an entry.
 * Archived items are refused, unless the entry already uses the item.
 */
export async function usable<T extends { archivedAt: Date | null }>(
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

export function accountOf(tx: Tx, bookId: string, id: string) {
  return tx
    .select({ currency: bookAccount.currency, archivedAt: bookAccount.archivedAt })
    .from(bookAccount)
    .where(and(eq(bookAccount.id, id), eq(bookAccount.bookId, bookId)));
}
export function subCategoryOf(tx: Tx, bookId: string, id: string) {
  return tx
    .select({ archivedAt: subCategory.archivedAt })
    .from(subCategory)
    .where(and(eq(subCategory.id, id), eq(subCategory.bookId, bookId)));
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

export const entryColumns = {
  version: journalEntry.version,
  id: journalEntry.id,
  date: journalEntry.date,
  accountId: journalEntry.accountId,
  subCategoryId: journalEntry.subCategoryId,
  description: journalEntry.description,
  amount: journalEntry.amount,
  plannedAmount: journalEntry.plannedAmount,
  exchangeRate: journalEntry.exchangeRate,
  bookAmount: journalEntry.bookAmount,
  originalAmount: journalEntry.originalAmount,
  originalCurrency: journalEntry.originalCurrency,
  reconciled: journalEntry.reconciled,
  monthShifted: journalEntry.monthShifted,
  scheduleId: journalEntry.scheduleId,
  transferId: journalEntry.transferId,
  transferLeg: journalEntry.transferLeg,
  compensationId: journalEntry.compensationId,
  compensationSide: journalEntry.compensationSide,
  splitId: journalEntry.splitId,
  splitRemainder: journalEntry.splitRemainder,
  loanId: journalEntry.loanId,
  createdAt: journalEntry.createdAt,
  updatedAt: journalEntry.updatedAt,
};
export type EntryRow = Omit<typeof journalEntry.$inferSelect, "bookId" | "importBatchId">;

/** Shapes an entry for JSON: amounts as decimal text in their currency. */
export function outEntry(row: EntryRow, currency: string, bookCurrency: string) {
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

/** Marks a split changed: its revision moves with its parts. */
export function touchSplit(tx: Tx, bookId: string, id: string) {
  return tx
    .update(split)
    .set({ updatedAt: new Date() })
    .where(and(eq(split.id, id), eq(split.bookId, bookId)));
}

/** A split is one bank movement counting in categories, never a transfer. */
export async function refuseTransferSubCategory(tx: Tx, bookId: string, id: string) {
  const [row] = await tx
    .select({ transfer: nature.transfer })
    .from(subCategory)
    .innerJoin(category, eq(category.id, subCategory.categoryId))
    .innerJoin(nature, eq(nature.id, category.natureId))
    .where(and(eq(subCategory.id, id), eq(subCategory.bookId, bookId)));
  if (row?.transfer) {
    throw new HTTPException(400, {
      message: "A split cannot use a sub-category of a transfer category",
    });
  }
}

/** Creates an entry; `planned` makes its planned amount the amount. */
export async function createEntry(
  tx: Tx,
  bookId: string,
  input: z.output<typeof entryInputSchema>,
) {
  const account = await usable(accountOf(tx, bookId, input.accountId), "account");
  await usable(subCategoryOf(tx, bookId, input.subCategoryId), "sub-category");
  const bookCurrency = await bookCurrencyOf(tx, bookId);
  const amount = checked(() => parseAmount(input.amount, account.currency));
  const rate = checked(() => resolveRate(account.currency, bookCurrency, input.exchangeRate));
  const [created] = await tx
    .insert(journalEntry)
    .values({
      bookId,
      date: input.date,
      accountId: input.accountId,
      subCategoryId: input.subCategoryId,
      description: input.description,
      amount: amount.minor,
      plannedAmount: input.planned ? amount.minor : 0n,
      exchangeRate: rate,
      bookAmount: checked(() => bookAmount(amount, rate, bookCurrency)).minor,
      ...originalOf(input.originalAmount, input.originalCurrency),
      reconciled: input.reconciled ?? false,
      monthShifted: input.monthShifted ?? false,
    })
    .returning(entryColumns);
  return outEntry(created!, account.currency, bookCurrency);
}

/** Changes an entry; with `version`, only if nobody changed it since. */
export async function updateEntry(
  tx: Tx,
  bookId: string,
  id: string,
  input: Omit<z.output<typeof entryUpdateSchema>, "version">,
  version?: number,
) {
  const [found] = await tx
    .select({ ...entryColumns, currency: bookAccount.currency })
    .from(journalEntry)
    .leftJoin(bookAccount, eq(bookAccount.id, journalEntry.accountId))
    .where(and(eq(journalEntry.id, id), eq(journalEntry.bookId, bookId)));
  if (!found) {
    throw new HTTPException(404, { message: "Entry not found" });
  }
  if (found.compensationId) {
    throw new HTTPException(400, {
      message: "This entry is one side of a compensation: change the compensation",
    });
  }
  // Only a side of a compensation has no account.
  const current = { ...found, currency: found.currency! };
  // A side of a transfer changes with the transfer; only its reconciling is its own.
  if (current.transferId && Object.keys(input).some((key) => key !== "reconciled")) {
    throw new HTTPException(400, {
      message: "This entry is one side of a transfer: change the transfer",
    });
  }
  if (input.planned && current.reconciled) {
    throw new HTTPException(400, {
      message: "The plan of a reconciled entry does not change",
    });
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
    if (current.splitId) await refuseTransferSubCategory(tx, bookId, input.subCategoryId);
  }
  const bookCurrency = await bookCurrencyOf(tx, bookId);
  const amount =
    input.amount === undefined
      ? money(current.amount, current.currency)
      : checked(() => parseAmount(input.amount!, current.currency));
  const rate = checked(() =>
    resolveRate(current.currency, bookCurrency, input.exchangeRate ?? current.exchangeRate),
  );
  // A shifted entry that changes date keeps its budget month, unless told otherwise.
  const monthShifted =
    input.monthShifted ??
    (current.monthShifted && input.date !== undefined
      ? shiftToKeep(input.date, budgetMonth(current.date, true))
      : undefined);
  const [updated] = await tx
    .update(journalEntry)
    .set({
      date: input.date,
      monthShifted,
      accountId: input.accountId,
      subCategoryId: input.subCategoryId,
      description: input.description,
      reconciled: input.reconciled,
      amount: amount.minor,
      // Written in the budget's plan: the plan and the expected amount move together.
      plannedAmount: input.planned ? amount.minor : undefined,
      exchangeRate: rate,
      bookAmount: checked(() => bookAmount(amount, rate, bookCurrency)).minor,
      ...(input.originalAmount !== undefined || input.originalCurrency !== undefined
        ? originalOf(input.originalAmount, input.originalCurrency)
        : {}),
    })
    .where(rowOf(journalEntry, bookId, id, version))
    .returning(entryColumns);
  if (!updated) return missing("Entry", version);
  if (current.splitId) {
    await shareWithParts(tx, bookId, current.splitId, id, updated, input);
    await touchSplit(tx, bookId, current.splitId);
  }
  return outEntry(updated, current.currency, bookCurrency);
}

/** Gives the other parts of a split what they share with the one just changed. */
async function shareWithParts(
  tx: Tx,
  bookId: string,
  splitId: string,
  changedId: string,
  changed: EntryRow,
  input: Omit<z.output<typeof entryUpdateSchema>, "version">,
) {
  const moved = input.date !== undefined || input.monthShifted !== undefined;
  const rated = input.exchangeRate !== undefined;
  if (!moved && !rated && input.accountId === undefined && input.reconciled === undefined) return;
  const others = await tx
    .select({ id: journalEntry.id, amount: journalEntry.amount })
    .from(journalEntry)
    .where(
      and(
        eq(journalEntry.bookId, bookId),
        eq(journalEntry.splitId, splitId),
        ne(journalEntry.id, changedId),
      ),
    );
  const bookCurrency = await bookCurrencyOf(tx, bookId);
  const [account] = await accountOf(tx, bookId, changed.accountId!);
  const currency = account!.currency;
  for (const other of others) {
    await tx
      .update(journalEntry)
      .set({
        ...(moved && { date: changed.date, monthShifted: changed.monthShifted }),
        accountId: input.accountId,
        reconciled: input.reconciled,
        ...(rated && {
          exchangeRate: changed.exchangeRate,
          bookAmount: bookAmount(money(other.amount, currency), changed.exchangeRate, bookCurrency)
            .minor,
        }),
      })
      .where(eq(journalEntry.id, other.id));
  }
}

/** Deletes an entry that is not a side of a transfer or a compensation; with `version`, only if unchanged. */
export async function deleteEntry(tx: Tx, bookId: string, id: string, version?: number) {
  const [found] = await tx
    .select({
      transferId: journalEntry.transferId,
      compensationId: journalEntry.compensationId,
      splitId: journalEntry.splitId,
    })
    .from(journalEntry)
    .where(and(eq(journalEntry.id, id), eq(journalEntry.bookId, bookId)));
  if (found?.splitId) {
    throw new HTTPException(400, {
      message: "This entry is a part of a split: change or delete the split",
    });
  }
  if (found?.transferId) {
    throw new HTTPException(400, {
      message: "This entry is one side of a transfer: delete the transfer",
    });
  }
  if (found?.compensationId) {
    throw new HTTPException(400, {
      message: "This entry is one side of a compensation: delete the compensation",
    });
  }
  const deleted = await tx
    .delete(journalEntry)
    .where(rowOf(journalEntry, bookId, id, version))
    .returning({ id: journalEntry.id });
  if (deleted.length === 0) return missing("Entry", version);
}

/** The parts of splits, by split. */
export async function splitsOf(tx: Tx, bookId: string, ids: string[]) {
  const parts = new Map<string, EntryRow[]>();
  if (ids.length === 0) return parts;
  const rows = await tx
    .select(entryColumns)
    .from(journalEntry)
    .where(and(eq(journalEntry.bookId, bookId), inArray(journalEntry.splitId, ids)))
    // The remainder last, the others as they were made.
    .orderBy(asc(journalEntry.splitRemainder), asc(journalEntry.createdAt), asc(journalEntry.id));
  for (const row of rows) parts.set(row.splitId!, [...(parts.get(row.splitId!) ?? []), row]);
  return parts;
}

/** What a part tells about its whole split: the bank amount and every part. */
function outSplit(parts: EntryRow[], currency: string) {
  const text = (minor: bigint) => toDecimalString(money(minor, currency));
  return {
    total: text(parts.reduce((sum, p) => sum + p.amount, 0n)),
    parts: parts.map((p) => ({
      id: p.id,
      subCategoryId: p.subCategoryId,
      description: p.description,
      amount: text(p.amount),
      plannedAmount: text(p.plannedAmount),
      remainder: p.splitRemainder,
    })),
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
          if (query.compensations) filters.push(isNotNull(journalEntry.compensationId));
          if (query.subCategoryId) {
            filters.push(eq(journalEntry.subCategoryId, query.subCategoryId));
          }
          if (query.months) {
            filters.push(
              query.months.length > 0
                ? inArray(sql`to_char(${BUDGET_DATE}, 'YYYY-MM')`, query.months)
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
              .leftJoin(bookAccount, eq(bookAccount.id, journalEntry.accountId))
              .where(where)
              .orderBy(desc(journalEntry.date), desc(journalEntry.createdAt), asc(journalEntry.id))
              .limit(query.limit)
              .offset(query.offset),
            tx.select({ n: count() }).from(journalEntry).where(where),
            bookCurrencyOf(tx, bookId),
          ]);
          const splits = await splitsOf(
            tx,
            bookId,
            rows.flatMap((row) => (row.splitId ? [row.splitId] : [])),
          );
          return {
            total: total?.n ?? 0,
            bookCurrency,
            // Without an account, an entry is in the book currency.
            entries: rows.map(({ currency, ...row }) => ({
              ...outEntry(row, currency ?? bookCurrency, bookCurrency),
              // The whole movement, whatever the filters left of it.
              split: row.splitId ? outSplit(splits.get(row.splitId)!, currency!) : null,
            })),
          };
        });
        return c.json(result);
      })

      // The descriptions most used in the last 12 months, each with its latest
      // entry, to start a new entry from. Only entries made in the journal count
      // (planned amount 0): a planned entry is changed or reconciled, not made again.
      .get("/frequent", async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const key = sql<string>`lower(btrim(${journalEntry.description}))`;
        const result = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "viewer");
          const top = await tx
            .select({ key, uses: count() })
            .from(journalEntry)
            .where(
              and(
                eq(journalEntry.bookId, bookId),
                eq(journalEntry.reconciled, true),
                eq(journalEntry.plannedAmount, 0n),
                isNull(journalEntry.transferId),
                isNull(journalEntry.compensationId),
                isNull(journalEntry.splitId),
                sql`${key} <> ''`,
                gte(journalEntry.date, sql`current_date - interval '12 months'`),
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
                  eq(journalEntry.plannedAmount, 0n),
                  isNull(journalEntry.transferId),
                  isNull(journalEntry.compensationId),
                  isNull(journalEntry.splitId),
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

      // The budget months holding entries, with their number, for the period picker.
      .get("/months", async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const month = sql<string>`to_char(${BUDGET_DATE}, 'YYYY-MM')`;
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
              // The opening balance is what the bank balance holds that no entry
              // explains, so it counts in the reconciled balance as in the total.
              reconciled: sql<string>`${bookAccount.openingBalance} + coalesce(sum(${journalEntry.amount}) filter (where ${journalEntry.reconciled}), 0)`,
              total: sql<string>`${bookAccount.openingBalance} + coalesce(sum(${journalEntry.amount}), 0)`,
            })
            .from(bookAccount)
            .leftJoin(journalEntry, eq(journalEntry.accountId, bookAccount.id))
            .where(eq(bookAccount.bookId, bookId))
            .groupBy(bookAccount.id, bookAccount.currency, bookAccount.openingBalance);
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
      // by day. Entries count reconciled or not, and so do the budget lines, past
      // months included; reconciled lines are 0.
      .get("/projection", zValidator("query", projectionQuerySchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const { from, to } = c.req.valid("query");
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
                openingBalance: bookAccount.openingBalance,
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
          // The account's own opening balance, then the entries before the window.
          const openingOf = new Map(
            accounts.map((a) => [a.id, a.openingBalance] as [string, bigint]),
          );
          // Compensations, without an account, move no balance.
          for (const { accountId, total } of opening) {
            if (accountId === null) continue;
            openingOf.set(accountId, (openingOf.get(accountId) ?? 0n) + BigInt(total));
          }
          const changes = new Map<string, Map<string, bigint>>();
          const addChange = (accountId: string, date: string, amount: bigint) => {
            const byDate = changes.get(accountId) ?? new Map<string, bigint>();
            byDate.set(date, (byDate.get(date) ?? 0n) + amount);
            changes.set(accountId, byDate);
          };
          const currencyOf = new Map(accounts.map((a) => [a.id, a.currency]));
          for (const { accountId, date, total } of days) {
            if (accountId !== null) addChange(accountId, date, BigInt(total));
          }
          for (const line of lines.flat()) {
            if (line.date < from || line.date > to) continue;
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
            opening: toDecimalString(money(openingOf.get(id) ?? 0n, currency)),
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
          return createEntry(tx, bookId, input);
        });
        return c.json(entry, 201);
      })

      .post("/reconcile", zValidator("json", reconcileSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const { ids, reconciled } = c.req.valid("json");
        const updated = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          // A split is reconciled whole, whichever of its parts were picked.
          const picked = await tx
            .selectDistinct({ splitId: journalEntry.splitId })
            .from(journalEntry)
            .where(
              and(
                eq(journalEntry.bookId, bookId),
                inArray(journalEntry.id, ids),
                isNotNull(journalEntry.splitId),
              ),
            );
          const splitIds = picked.map((row) => row.splitId!);
          for (const id of splitIds) await touchSplit(tx, bookId, id);
          return tx
            .update(journalEntry)
            .set({ reconciled })
            .where(
              and(
                eq(journalEntry.bookId, bookId),
                splitIds.length > 0
                  ? or(inArray(journalEntry.id, ids), inArray(journalEntry.splitId, splitIds))
                  : inArray(journalEntry.id, ids),
                // A compensation has nothing to reconcile.
                isNull(journalEntry.compensationId),
              ),
            )
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
          return updateEntry(tx, bookId, id, input, version);
        });
        return c.json(entry);
      })

      .delete("/:id", async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Entry");
        await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          await deleteEntry(tx, bookId, id);
        });
        return c.body(null, 204);
      })
  );
}

import { zValidator } from "@hono/zod-validator";
import {
  MONTHS,
  currentMonthOf,
  dashboardQuerySchema,
  money,
  monthEndBalances,
  parseAmount,
  toDecimalString,
  unusedBudget,
} from "@cash-scout/domain";
import { and, count, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { withUser, type Db } from "../db/client.js";
import { book, bookAccount, category, journalEntry, nature, subCategory } from "../db/schema.js";
import type { AppEnv } from "../http.js";
import { idOf, requireRole } from "./access.js";
import { consumptionSign, loadYear, monthEnds, monthsOf } from "./budget-months.js";

const MONTH = sql<number>`extract(month from ${journalEntry.date})::int`;

/**
 * The year dashboard of a book, mounted under /books/:bookId/dashboard: what
 * the grid of the page is made of, all in the book currency. Members read.
 *
 * - `cells`: what the entries hold per sub-category and month, transfers left out.
 * - `unused`: for each periodic budget of the year, what it leaves for the months
 *   after the current one, signed like the entries.
 * - `balances`: the balance of each bank account at the end of each month.
 */
export function dashboardRoutes(db: Db) {
  return new Hono<AppEnv>().get("/", zValidator("query", dashboardQuerySchema), async (c) => {
    const me = c.var.user.id;
    const bookId = idOf(c.req.param("bookId"));
    const { year, today } = c.req.valid("query");
    const result = await withUser(db, me, async (tx) => {
      await requireRole(tx, bookId, me, "viewer");
      const [bookRow] = await tx
        .select({ currency: book.currency })
        .from(book)
        .where(eq(book.id, bookId));
      if (!bookRow) {
        throw new HTTPException(404, { message: "Book not found" });
      }
      const bookCurrency = bookRow.currency;
      const text = (minor: bigint) => toDecimalString(money(minor, bookCurrency));
      const current = currentMonthOf(year, today);
      const thisYear = sql`extract(year from ${journalEntry.date}) = ${year}`;

      const [cells, budgets, accounts, opening, changes, lines] = await Promise.all([
        tx
          .select({
            subCategoryId: journalEntry.subCategoryId,
            month: MONTH,
            total: sql<string>`sum(${journalEntry.bookAmount})`,
            entries: count(),
          })
          .from(journalEntry)
          .innerJoin(subCategory, eq(subCategory.id, journalEntry.subCategoryId))
          .innerJoin(category, eq(category.id, subCategory.categoryId))
          .innerJoin(nature, eq(nature.id, category.natureId))
          .where(and(eq(journalEntry.bookId, bookId), thisYear, eq(nature.transfer, false)))
          .groupBy(journalEntry.subCategoryId, MONTH),
        loadYear(tx, bookId, year),
        tx
          .select({
            id: bookAccount.id,
            archived: sql<boolean>`${bookAccount.archivedAt} is not null`,
          })
          .from(bookAccount)
          .where(and(eq(bookAccount.bookId, bookId), eq(bookAccount.kind, "bank"))),
        tx
          .select({
            accountId: journalEntry.accountId,
            total: sql<string>`sum(${journalEntry.bookAmount})`,
          })
          .from(journalEntry)
          .where(
            and(eq(journalEntry.bookId, bookId), sql`${journalEntry.date} < ${`${year}-01-01`}`),
          )
          .groupBy(journalEntry.accountId),
        tx
          .select({
            accountId: journalEntry.accountId,
            month: MONTH,
            total: sql<string>`sum(${journalEntry.bookAmount})`,
          })
          .from(journalEntry)
          .where(and(eq(journalEntry.bookId, bookId), thisYear))
          .groupBy(journalEntry.accountId, MONTH),
        monthEnds(tx, bookId, bookCurrency, year),
      ]);

      // Unused budget of the periodic categories: each month's own share that
      // the month's entries have not used, for the months still ahead.
      const weightsOf = new Map(budgets.profiles.map((p) => [p.id, p.weights]));
      const unused = budgets.rows.flatMap((row) => {
        if (row.type !== "periodic" || !row.amount) return [];
        const months = monthsOf(row, row.sign, weightsOf, budgets.consumption);
        const left = unusedBudget(
          months.map((m) => m.allocated),
          months.map((m) => m.consumed),
          current,
        );
        const sign = consumptionSign(row.sign);
        return [{ categoryId: row.categoryId, months: left.map((amount) => text(sign * amount)) }];
      });

      // Balances: the entries' book amounts, then the unused-budget lines of the
      // months not yet past, as the cash projection counts them.
      const openingOf = new Map(opening.map((row) => [row.accountId, BigInt(row.total)]));
      const changesOf = new Map<string, bigint[]>();
      const changeOf = (accountId: string) => {
        const months = changesOf.get(accountId) ?? Array<bigint>(MONTHS).fill(0n);
        changesOf.set(accountId, months);
        return months;
      };
      for (const row of changes) {
        const months = changeOf(row.accountId);
        months[row.month - 1] = months[row.month - 1]! + BigInt(row.total);
      }
      for (const line of lines) {
        if (line.date.slice(0, 7) < today.slice(0, 7)) continue;
        const months = changeOf(line.accountId);
        months[line.month - 1] =
          months[line.month - 1]! + parseAmount(line.bookAmount, bookCurrency).minor;
      }
      const balances = accounts.flatMap(({ id, archived }) => {
        const ends = monthEndBalances(
          openingOf.get(id) ?? 0n,
          changesOf.get(id) ?? Array<bigint>(MONTHS).fill(0n),
        );
        // A closed account with nothing in the year is not worth a line.
        if (archived && ends.every((balance) => balance === 0n)) return [];
        return [{ accountId: id, ends: ends.map(text) }];
      });

      return {
        year,
        bookCurrency,
        currentMonth: current,
        cells: cells.map((cell) => ({
          subCategoryId: cell.subCategoryId,
          month: cell.month,
          total: text(BigInt(cell.total)),
          entries: cell.entries,
        })),
        unused,
        balances,
      };
    });
    return c.json(result);
  });
}

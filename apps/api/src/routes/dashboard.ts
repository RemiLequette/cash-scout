import { zValidator } from "@hono/zod-validator";
import {
  MONTHS,
  currentMonthOf,
  dashboardQuerySchema,
  money,
  monthEndBalances,
  parseAmount,
  toDecimalString,
} from "@cash-scout/domain";
import { and, count, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { BUDGET_MONTH, inBudgetYear } from "../db/budget-date.js";
import { withUser, type Db } from "../db/client.js";
import { book, bookAccount, category, journalEntry, nature, subCategory } from "../db/schema.js";
import type { AppEnv } from "../http.js";
import { idOf, requireRole } from "./access.js";
import { monthEnds } from "./budget-months.js";

const MONTH = sql<number>`extract(month from ${journalEntry.date})::int`;

/**
 * The year dashboard of a book, mounted under /books/:bookId/dashboard: what
 * the grid of the page is made of, all in the book currency. Members read.
 *
 * - `cells`: what the entries hold per sub-category and budget month, transfers left out.
 * - `budgetLines`: the budget lines of the year per category and month, signed
 *   like the entries; 0 when used up or reconciled.
 * - `balances`: the balance of each bank account at the end of each month, by date.
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

      const [cells, accounts, opening, changes, lines] = await Promise.all([
        tx
          .select({
            subCategoryId: journalEntry.subCategoryId,
            month: BUDGET_MONTH,
            total: sql<string>`sum(${journalEntry.bookAmount})`,
            entries: count(),
          })
          .from(journalEntry)
          .innerJoin(subCategory, eq(subCategory.id, journalEntry.subCategoryId))
          .innerJoin(category, eq(category.id, subCategory.categoryId))
          .innerJoin(nature, eq(nature.id, category.natureId))
          .where(
            and(eq(journalEntry.bookId, bookId), inBudgetYear(year), eq(nature.transfer, false)),
          )
          .groupBy(journalEntry.subCategoryId, BUDGET_MONTH),
        tx
          .select({
            id: bookAccount.id,
            openingBookAmount: bookAccount.openingBookAmount,
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

      const budgetLines = new Map<string, bigint[]>();
      for (const line of lines) {
        const months = budgetLines.get(line.categoryId) ?? Array<bigint>(MONTHS).fill(0n);
        months[line.month - 1] = parseAmount(line.bookAmount, bookCurrency).minor;
        budgetLines.set(line.categoryId, months);
      }

      // Balances: the entries' book amounts, then the budget lines, past months
      // included, as the cash projection counts them.
      // The account's own opening balance, then the entries before the year.
      const openingOf = new Map(
        accounts.map((a) => [a.id, a.openingBookAmount] as [string, bigint]),
      );
      for (const row of opening) {
        openingOf.set(row.accountId, (openingOf.get(row.accountId) ?? 0n) + BigInt(row.total));
      }
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
        budgetLines: [...budgetLines].map(([categoryId, months]) => ({
          categoryId,
          months: months.map(text),
        })),
        balances,
      };
    });
    return c.json(result);
  });
}

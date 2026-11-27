import { zValidator } from "@hono/zod-validator";
import {
  MONTHS,
  currentMonthOf,
  dashboardQuerySchema,
  entryDateSchema,
  money,
  monthEndBalances,
  parseAmount,
  toDecimalString,
} from "@cash-scout/domain";
import { and, count, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { BUDGET_MONTH, BUDGET_YEAR, inBudgetYear } from "../db/budget-date.js";
import { withUser, type Db, type Tx } from "../db/client.js";
import {
  book,
  bookAccount,
  category,
  categoryBudget,
  journalEntry,
  nature,
  subCategory,
} from "../db/schema.js";
import type { AppEnv } from "../http.js";
import { idOf, requireRole } from "./access.js";
import { monthEnds } from "./budget-months.js";

const MONTH = sql<number>`extract(month from ${journalEntry.date})::int`;

const YEAR = sql<number>`extract(year from ${journalEntry.date})::int`;

async function currencyOfBook(tx: Tx, bookId: string): Promise<string> {
  const [row] = await tx.select({ currency: book.currency }).from(book).where(eq(book.id, bookId));
  if (!row) {
    throw new HTTPException(404, { message: "Book not found" });
  }
  return row.currency;
}

/**
 * Every year of a book at once: the figures of the year dashboard, one amount
 * per year, from the first year holding an entry or a budget to the last.
 * `ends` are the balances at each year's end, counted as December's in the
 * year dashboard.
 */
async function yearlyFigures(tx: Tx, bookId: string, today: string) {
  const bookCurrency = await currencyOfBook(tx, bookId);
  const text = (minor: bigint) => toDecimalString(money(minor, bookCurrency));
  const ofBook = eq(journalEntry.bookId, bookId);

  const [cells, accounts, changes, moves, budgeted] = await Promise.all([
    tx
      .select({
        subCategoryId: journalEntry.subCategoryId,
        year: BUDGET_YEAR,
        total: sql<string>`sum(${journalEntry.bookAmount})`,
      })
      .from(journalEntry)
      .innerJoin(subCategory, eq(subCategory.id, journalEntry.subCategoryId))
      .innerJoin(category, eq(category.id, subCategory.categoryId))
      .innerJoin(nature, eq(nature.id, category.natureId))
      .where(and(ofBook, eq(nature.transfer, false)))
      .groupBy(journalEntry.subCategoryId, BUDGET_YEAR),
    tx
      .select({
        id: bookAccount.id,
        openingBookAmount: bookAccount.openingBookAmount,
        archived: sql<boolean>`${bookAccount.archivedAt} is not null`,
      })
      .from(bookAccount)
      .where(eq(bookAccount.bookId, bookId)),
    tx
      .select({
        accountId: journalEntry.accountId,
        year: YEAR,
        total: sql<string>`sum(${journalEntry.bookAmount})`,
      })
      .from(journalEntry)
      .where(ofBook)
      .groupBy(journalEntry.accountId, YEAR),
    tx
      .select({
        accountId: journalEntry.accountId,
        year: YEAR,
        total: sql<string>`sum(${journalEntry.bookAmount})`,
      })
      .from(journalEntry)
      .innerJoin(subCategory, eq(subCategory.id, journalEntry.subCategoryId))
      .innerJoin(category, eq(category.id, subCategory.categoryId))
      .innerJoin(nature, eq(nature.id, category.natureId))
      .where(and(ofBook, eq(nature.transfer, true)))
      .groupBy(journalEntry.accountId, YEAR),
    tx
      .selectDistinct({ year: categoryBudget.year })
      .from(categoryBudget)
      .where(
        and(
          eq(categoryBudget.bookId, bookId),
          sql`exists (select 1 from unnest(${categoryBudget.months}) as m where m <> 0)`,
        ),
      ),
  ]);

  const held = [...cells, ...changes, ...budgeted].map((row) => row.year);
  const first = Math.min(...held);
  const years =
    held.length === 0
      ? []
      : Array.from({ length: Math.max(...held) - first + 1 }, (_, i) => first + i);

  // The budget lines, summed per category and per account: computed, not stored.
  const budgetLines = new Map<string, { categoryId: string; year: number; total: bigint }>();
  const linesOf = new Map<string, bigint>();
  for (const { year } of budgeted) {
    for (const line of await monthEnds(tx, bookId, bookCurrency, year)) {
      const amount = parseAmount(line.bookAmount, bookCurrency).minor;
      const key = `${line.categoryId}:${year}`;
      const sum = budgetLines.get(key) ?? { categoryId: line.categoryId, year, total: 0n };
      sum.total += amount;
      budgetLines.set(key, sum);
      const of = `${line.accountId}:${year}`;
      linesOf.set(of, (linesOf.get(of) ?? 0n) + amount);
    }
  }

  // Compensations, without an account, move no balance.
  const byAccountYear = (rows: typeof changes) =>
    new Map(rows.map((r) => [`${r.accountId}:${r.year}`, BigInt(r.total)]));
  const changeOf = byAccountYear(changes);
  const moveOf = byAccountYear(moves);

  const balances = accounts.flatMap(({ id, openingBookAmount, archived }) => {
    let entries = openingBookAmount;
    const ends = years.map((year) => {
      entries += changeOf.get(`${id}:${year}`) ?? 0n;
      // As December in the year dashboard: only this year's budget lines.
      return entries + (linesOf.get(`${id}:${year}`) ?? 0n);
    });
    if (archived && ends.every((balance) => balance === 0n)) return [];
    return [{ accountId: id, ends: ends.map(text) }];
  });
  const transfers = accounts.flatMap(({ id }) => {
    if (!years.some((year) => moveOf.has(`${id}:${year}`))) return [];
    const amounts = years.map((year) => text(moveOf.get(`${id}:${year}`) ?? 0n));
    return [{ accountId: id, years: amounts }];
  });

  return {
    bookCurrency,
    currentYear: Number(today.slice(0, 4)),
    years,
    cells: cells.map((cell) => ({
      subCategoryId: cell.subCategoryId,
      year: cell.year,
      total: text(BigInt(cell.total)),
    })),
    budgetLines: [...budgetLines.values()].map((line) => ({ ...line, total: text(line.total) })),
    transfers,
    balances,
  };
}

/**
 * The year dashboard of a book, mounted under /books/:bookId/dashboard: what
 * the grid of the page is made of, all in the book currency. Members read.
 *
 * - `cells`: what the entries hold per sub-category and budget month, transfers left out.
 * - `budgetLines`: the budget lines of the year per category and month, signed
 *   like the entries; 0 when used up or reconciled.
 * - `transfers`: what the transfer entries moved in or out of each bank account
 *   per month, by date; only the accounts they touch.
 * - `balances`: the balance of each bank account at the end of each month, by date.
 *
 * `/years` gives the same for every year at once, one amount per year.
 */
export function dashboardRoutes(db: Db) {
  const years = new Hono<AppEnv>().get(
    "/years",
    zValidator("query", z.object({ today: entryDateSchema })),
    async (c) => {
      const me = c.var.user.id;
      const bookId = idOf(c.req.param("bookId"));
      const { today } = c.req.valid("query");
      const result = await withUser(db, me, async (tx) => {
        await requireRole(tx, bookId, me, "viewer");
        return yearlyFigures(tx, bookId, today);
      });
      return c.json(result);
    },
  );
  const year = new Hono<AppEnv>().get("/", zValidator("query", dashboardQuerySchema), async (c) => {
    const me = c.var.user.id;
    const bookId = idOf(c.req.param("bookId"));
    const { year, today } = c.req.valid("query");
    const result = await withUser(db, me, async (tx) => {
      await requireRole(tx, bookId, me, "viewer");
      const bookCurrency = await currencyOfBook(tx, bookId);
      const text = (minor: bigint) => toDecimalString(money(minor, bookCurrency));
      const current = currentMonthOf(year, today);
      const thisYear = sql`extract(year from ${journalEntry.date}) = ${year}`;

      const [cells, accounts, opening, changes, moves, lines] = await Promise.all([
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
          .where(eq(bookAccount.bookId, bookId)),
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
        tx
          .select({
            accountId: journalEntry.accountId,
            month: MONTH,
            total: sql<string>`sum(${journalEntry.bookAmount})`,
          })
          .from(journalEntry)
          .innerJoin(subCategory, eq(subCategory.id, journalEntry.subCategoryId))
          .innerJoin(category, eq(category.id, subCategory.categoryId))
          .innerJoin(nature, eq(nature.id, category.natureId))
          .where(and(eq(journalEntry.bookId, bookId), thisYear, eq(nature.transfer, true)))
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
      // Compensations, without an account, move no balance.
      for (const { accountId, total } of opening) {
        if (accountId === null) continue;
        openingOf.set(accountId, (openingOf.get(accountId) ?? 0n) + BigInt(total));
      }
      const changesOf = new Map<string, bigint[]>();
      const changeOf = (accountId: string) => {
        const months = changesOf.get(accountId) ?? Array<bigint>(MONTHS).fill(0n);
        changesOf.set(accountId, months);
        return months;
      };
      for (const row of changes) {
        if (row.accountId === null) continue;
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

      const movesOf = new Map<string, bigint[]>();
      for (const row of moves) {
        if (row.accountId === null) continue;
        const months = movesOf.get(row.accountId) ?? Array<bigint>(MONTHS).fill(0n);
        months[row.month - 1] = BigInt(row.total);
        movesOf.set(row.accountId, months);
      }
      // In the order of the accounts, as the balances.
      const transfers = accounts.flatMap(({ id }) => {
        const months = movesOf.get(id);
        return months ? [{ accountId: id, months: months.map(text) }] : [];
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
        transfers,
        balances,
      };
    });
    return c.json(result);
  });
  return new Hono<AppEnv>().route("/", year).route("/", years);
}

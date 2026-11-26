import {
  convert,
  MONTHS,
  money,
  remainingBudget,
  toDecimalString,
  unconvert,
} from "@cash-scout/domain";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { Tx } from "../db/client.js";
import {
  bookAccount,
  budgetSettlement,
  category,
  categoryBudget,
  journalEntry,
  nature,
  subCategory,
} from "../db/schema.js";

const MONTH = sql<number>`extract(month from ${journalEntry.date})::int`;

export const budgetColumns = {
  version: categoryBudget.version,
  id: categoryBudget.id,
  categoryId: categoryBudget.categoryId,
  year: categoryBudget.year,
  assumptions: categoryBudget.assumptions,
  months: categoryBudget.months,
  accountId: categoryBudget.accountId,
  exchangeRate: categoryBudget.exchangeRate,
};

/** What the journal holds for a category in each month, in minor units of the book currency. */
export interface CategoryJournal {
  /** Every entry. */
  actual: bigint[];
  /** The unplanned entries (planned amount 0): what consumes the grid. */
  unplanned: bigint[];
  /** The planned amounts of the entries, budgeted on top of the grid. */
  planned: bigint[];
}

const zeros = () => Array<bigint>(MONTHS).fill(0n);

/**
 * The budgets of a year and what the journal holds for every category with
 * entries, all read with the sign of the category's nature.
 */
export async function loadYear(tx: Tx, bookId: string, bookCurrency: string, year: number) {
  const inYear = and(
    eq(journalEntry.bookId, bookId),
    sql`extract(year from ${journalEntry.date}) = ${year}`,
  );
  const [rows, totals, plannedEntries] = await Promise.all([
    tx
      .select({ ...budgetColumns, code: category.code, sign: nature.sign })
      .from(categoryBudget)
      .innerJoin(category, eq(category.id, categoryBudget.categoryId))
      .innerJoin(nature, eq(nature.id, category.natureId))
      .where(and(eq(categoryBudget.bookId, bookId), eq(categoryBudget.year, year)))
      .orderBy(asc(category.code)),
    tx
      .select({
        categoryId: subCategory.categoryId,
        sign: nature.sign,
        month: MONTH,
        actual: sql<string>`sum(${journalEntry.bookAmount})`,
        unplanned: sql<string>`coalesce(sum(${journalEntry.bookAmount}) filter (where ${journalEntry.plannedAmount} = 0), 0)`,
      })
      .from(journalEntry)
      .innerJoin(subCategory, eq(subCategory.id, journalEntry.subCategoryId))
      .innerJoin(category, eq(category.id, subCategory.categoryId))
      .innerJoin(nature, eq(nature.id, category.natureId))
      .where(inYear)
      .groupBy(subCategory.categoryId, nature.sign, MONTH),
    // One by one: each planned amount is converted at its own entry's rate.
    tx
      .select({
        categoryId: subCategory.categoryId,
        sign: nature.sign,
        month: MONTH,
        plannedAmount: journalEntry.plannedAmount,
        exchangeRate: journalEntry.exchangeRate,
        currency: bookAccount.currency,
      })
      .from(journalEntry)
      .innerJoin(subCategory, eq(subCategory.id, journalEntry.subCategoryId))
      .innerJoin(category, eq(category.id, subCategory.categoryId))
      .innerJoin(nature, eq(nature.id, category.natureId))
      .innerJoin(bookAccount, eq(bookAccount.id, journalEntry.accountId))
      .where(and(inYear, ne(journalEntry.plannedAmount, 0n))),
  ]);

  const journal = new Map<string, CategoryJournal>();
  const of = (categoryId: string) => {
    const found = journal.get(categoryId) ?? {
      actual: zeros(),
      unplanned: zeros(),
      planned: zeros(),
    };
    journal.set(categoryId, found);
    return found;
  };
  for (const row of totals) {
    const sign = BigInt(row.sign);
    const category = of(row.categoryId);
    category.actual[row.month - 1] = sign * BigInt(row.actual);
    category.unplanned[row.month - 1] = sign * BigInt(row.unplanned);
  }
  for (const row of plannedEntries) {
    const own = money(row.plannedAmount, row.currency);
    const inBook =
      row.currency === bookCurrency ? own : convert(own, row.exchangeRate, bookCurrency);
    const months = of(row.categoryId).planned;
    months[row.month - 1] = months[row.month - 1]! + BigInt(row.sign) * inBook.minor;
  }
  return { rows, journal };
}

/**
 * A budget line: the virtual entry that, at the end of a month, holds what the
 * month's grid amount still expects, on the budget's account. Reconciling it
 * lets that go and sets it to 0.
 */
export interface MonthEnd {
  budgetId: string;
  categoryId: string;
  accountId: string;
  year: number;
  month: number;
  /** The month's last day, "2026-11-30". */
  date: string;
  /** Currency of the account. */
  currency: string;
  /** Signed like an entry, in the account currency: 0 once reconciled. */
  amount: string;
  /** The same in the book currency. */
  bookAmount: string;
  /** The grid amount, signed like an entry, in the account currency. */
  plannedAmount: string;
  /** The same in the book currency. */
  plannedBookAmount: string;
  /** What remained before reconciling, in the book currency, with the nature's sign. */
  unused: string;
  reconciled: boolean;
}

const lastDay = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

/**
 * The budget lines of a year: one for every month whose grid amount is not
 * zero, even used up or reconciled. A budget without an account has none.
 */
export async function monthEnds(
  tx: Tx,
  bookId: string,
  bookCurrency: string,
  year: number,
): Promise<MonthEnd[]> {
  const [{ rows, journal }, settled, accounts] = await Promise.all([
    loadYear(tx, bookId, bookCurrency, year),
    tx
      .select({ categoryId: budgetSettlement.categoryId, month: budgetSettlement.month })
      .from(budgetSettlement)
      .where(and(eq(budgetSettlement.bookId, bookId), eq(budgetSettlement.year, year))),
    tx
      .select({ id: bookAccount.id, currency: bookAccount.currency })
      .from(bookAccount)
      .where(eq(bookAccount.bookId, bookId)),
  ]);
  const currencyOf = new Map(accounts.map((a) => [a.id, a.currency]));
  const isSettled = new Set(settled.map((s) => `${s.categoryId}:${s.month}`));
  const lines: MonthEnd[] = [];
  for (const row of rows) {
    if (!row.accountId) continue;
    const currency = currencyOf.get(row.accountId);
    if (!currency) continue;
    const used = journal.get(row.categoryId)?.unplanned ?? zeros();
    const sign = BigInt(row.sign);
    row.months.forEach((budget, index) => {
      if (budget === 0n) return;
      const month = index + 1;
      const remaining = remainingBudget(budget, used[index]!);
      const reconciled = isSettled.has(`${row.categoryId}:${month}`);
      const inBook = money(reconciled ? 0n : sign * remaining, bookCurrency);
      const planned = money(sign * budget, bookCurrency);
      const own = (value: typeof inBook) => unconvert(value, row.exchangeRate ?? "1", currency);
      lines.push({
        budgetId: row.id,
        categoryId: row.categoryId,
        accountId: row.accountId!,
        year,
        month,
        date: lastDay(year, month),
        currency,
        amount: toDecimalString(own(inBook)),
        bookAmount: toDecimalString(inBook),
        plannedAmount: toDecimalString(own(planned)),
        plannedBookAmount: toDecimalString(planned),
        unused: toDecimalString(money(remaining, bookCurrency)),
        reconciled,
      });
    });
  }
  return lines;
}

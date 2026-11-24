import {
  allocate,
  budgetMonths,
  MONTHS,
  money,
  settlementMonths,
  toDecimalString,
  unconvert,
  type BudgetMonth,
} from "@cash-scout/domain";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Tx } from "../db/client.js";
import {
  bookAccount,
  budgetProfile,
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
  type: categoryBudget.type,
  assumptions: categoryBudget.assumptions,
  amount: categoryBudget.amount,
  profileId: categoryBudget.profileId,
  consumption: categoryBudget.consumption,
  accountId: categoryBudget.accountId,
  exchangeRate: categoryBudget.exchangeRate,
};

/** What the journal consumed, per category and month of a year, in the book currency. */
export type Consumption = Awaited<ReturnType<typeof loadYear>>["consumption"];

/** The budgets of a year, the profiles' weights and what the journal consumed. */
export async function loadYear(tx: Tx, bookId: string, year: number) {
  const [rows, profiles, consumption] = await Promise.all([
    tx
      .select({ ...budgetColumns, code: category.code, sign: nature.sign })
      .from(categoryBudget)
      .innerJoin(category, eq(category.id, categoryBudget.categoryId))
      .innerJoin(nature, eq(nature.id, category.natureId))
      .where(and(eq(categoryBudget.bookId, bookId), eq(categoryBudget.year, year)))
      .orderBy(asc(category.code)),
    tx
      .select({ id: budgetProfile.id, weights: budgetProfile.weights })
      .from(budgetProfile)
      .where(eq(budgetProfile.bookId, bookId)),
    tx
      .select({
        categoryId: subCategory.categoryId,
        sign: nature.sign,
        month: MONTH,
        total: sql<string>`sum(${journalEntry.bookAmount})`,
      })
      .from(journalEntry)
      .innerJoin(subCategory, eq(subCategory.id, journalEntry.subCategoryId))
      .innerJoin(category, eq(category.id, subCategory.categoryId))
      .innerJoin(nature, eq(nature.id, category.natureId))
      .where(
        and(
          eq(journalEntry.bookId, bookId),
          sql`extract(year from ${journalEntry.date}) = ${year}`,
        ),
      )
      .groupBy(subCategory.categoryId, nature.sign, MONTH),
  ]);
  return {
    rows,
    profiles,
    consumption: consumption.map((c) => ({ ...c, total: BigInt(c.total) })),
  };
}

/** The sign that makes a category's consumption read positive: its nature's sign. */
export const consumptionSign = (sign: number) => BigInt(sign);

/** The 12 months of a periodic budget, in minor units of the book currency. */
export function monthsOf(
  row: {
    categoryId: string;
    amount: bigint | null;
    profileId: string | null;
    consumption: string | null;
  },
  sign: number,
  weightsOf: Map<string, number[]>,
  consumption: Consumption,
): BudgetMonth[] {
  const factor = consumptionSign(sign);
  const used = Array<bigint>(MONTHS).fill(0n);
  for (const entry of consumption) {
    if (entry.categoryId === row.categoryId) used[entry.month - 1] = factor * entry.total;
  }
  return budgetMonths(
    allocate(row.amount!, weightsOf.get(row.profileId!)!),
    used,
    row.consumption as "lapse" | "roll_over" | "annual_pool",
  );
}

/**
 * A month-end line of the journal: what a periodic category's budget did not use
 * in a month, as a forecast entry on the category's reference account, dated the
 * month's last day. Settling it ("reconciling") sets it to 0.
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
  /** Signed, in the account currency: 0 once settled. */
  amount: string;
  /** The same in the book currency. */
  bookAmount: string;
  /** The unused budget before settling, positive, in the book currency. */
  unused: string;
  reconciled: boolean;
}

const lastDay = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

/**
 * The month-end lines of a year. A budget that has no account yet (budgets
 * from before the account became required) has none. A month with nothing
 * unused, or overspent, has none either, unless it was settled.
 */
export async function monthEnds(
  tx: Tx,
  bookId: string,
  bookCurrency: string,
  year: number,
): Promise<MonthEnd[]> {
  const [{ rows, profiles, consumption }, settled, accounts] = await Promise.all([
    loadYear(tx, bookId, year),
    tx
      .select({ categoryId: budgetSettlement.categoryId, month: budgetSettlement.month })
      .from(budgetSettlement)
      .where(and(eq(budgetSettlement.bookId, bookId), eq(budgetSettlement.year, year))),
    tx
      .select({ id: bookAccount.id, currency: bookAccount.currency })
      .from(bookAccount)
      .where(eq(bookAccount.bookId, bookId)),
  ]);
  const weightsOf = new Map(profiles.map((p) => [p.id, p.weights]));
  const currencyOf = new Map(accounts.map((a) => [a.id, a.currency]));
  const isSettled = new Set(settled.map((s) => `${s.categoryId}:${s.month}`));
  const lines: MonthEnd[] = [];
  for (const row of rows) {
    if (row.type !== "periodic" || !row.accountId) continue;
    const currency = currencyOf.get(row.accountId);
    if (!currency) continue;
    const months = monthsOf(row, row.sign, weightsOf, consumption);
    for (const month of settlementMonths(row.consumption!)) {
      const unused = months[month - 1]!.remaining;
      const reconciled = isSettled.has(`${row.categoryId}:${month}`);
      if (unused <= 0n && !reconciled) continue;
      const bookMinor = reconciled ? 0n : consumptionSign(row.sign) * unused;
      const book = money(bookMinor, bookCurrency);
      const own = unconvert(book, row.exchangeRate ?? "1", currency);
      lines.push({
        budgetId: row.id,
        categoryId: row.categoryId,
        accountId: row.accountId,
        year,
        month,
        date: lastDay(year, month),
        currency,
        amount: toDecimalString(own),
        bookAmount: toDecimalString(book),
        unused: toDecimalString(money(unused > 0n ? unused : 0n, bookCurrency)),
        reconciled,
      });
    }
  }
  return lines;
}

import { and, count, eq, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import type { Tx } from "../db/client.js";
import {
  balanceNature,
  bookAccount,
  budgetSettlement,
  category,
  categoryBudget,
  categoryGroup,
  importBatch,
  journalEntry,
  loan,
  nature,
  subCategory,
} from "../db/schema.js";

export type ReferrerType =
  | "groups"
  | "categories"
  | "subCategories"
  | "balances"
  | "budgets"
  | "budgetMonths"
  | "entries"
  | "loans"
  | "statements";

export interface Referrer {
  type: ReferrerType;
  count: number;
}

/** A deletion refused because other items refer to the item: which, and how many. */
export class InUseError extends HTTPException {
  constructor(readonly references: Referrer[]) {
    super(409, {
      message: `Still in use by ${references.map((r) => `${r.count} ${r.type}`).join(", ")}: archive it instead`,
    });
  }
}

type Referring = [ReferrerType, PgTable & { bookId: PgColumn }, PgColumn];

/**
 * What holds each kind of item: the foreign keys that refuse a deletion. Those
 * that cascade or are emptied (rules, statement lines) do not.
 */
const referring = new Map<PgTable, Referring[]>([
  [
    categoryGroup,
    [
      ["groups", categoryGroup, categoryGroup.parentId],
      ["categories", category, category.groupId],
    ],
  ],
  [
    nature,
    [
      ["categories", category, category.natureId],
      ["balances", balanceNature, balanceNature.natureId],
    ],
  ],
  [
    category,
    [
      ["subCategories", subCategory, subCategory.categoryId],
      ["budgets", categoryBudget, categoryBudget.categoryId],
      ["budgetMonths", budgetSettlement, budgetSettlement.categoryId],
    ],
  ],
  [
    subCategory,
    [
      ["entries", journalEntry, journalEntry.subCategoryId],
      ["loans", loan, loan.capitalSubCategoryId],
      ["loans", loan, loan.interestSubCategoryId],
      ["loans", loan, loan.insuranceSubCategoryId],
      ["loans", loan, loan.penaltySubCategoryId],
    ],
  ],
  [
    bookAccount,
    [
      ["entries", journalEntry, journalEntry.accountId],
      ["budgets", categoryBudget, categoryBudget.accountId],
      ["statements", importBatch, importBatch.accountId],
      ["loans", loan, loan.accountId],
    ],
  ],
]);

/** Throws an InUseError when the item of `table` cannot be deleted. */
export async function requireUnused(tx: Tx, table: PgTable, bookId: string, id: string) {
  const found: Referrer[] = [];
  for (const [type, from, column] of referring.get(table) ?? []) {
    const where: SQL | undefined = and(eq(from.bookId, bookId), eq(column, id));
    const [row] = await tx.select({ count: count() }).from(from).where(where);
    if (row!.count > 0) found.push({ type, count: row!.count });
  }
  if (found.length > 0) throw new InUseError(found);
}

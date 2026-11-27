import { getTableColumns, getTableName } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import {
  balance,
  balanceNature,
  bookAccount,
  bookLanguage,
  bookMember,
  budgetSettlement,
  category,
  categoryBudget,
  categoryGroup,
  compensation,
  importBatch,
  importLine,
  importRule,
  journalEntry,
  nature,
  split,
  subCategory,
  transfer,
} from "../db/schema.js";

/** A table of a book, as its export carries it (see docs/book-export.md). */
export interface ArchivedTable {
  table: PgTable;
  /** The columns that name a row of another table: they are renumbered on import. */
  references: Record<string, PgTable>;
}

/** In the order they can be written: a row only refers to rows written before it. */
export const ARCHIVED: readonly ArchivedTable[] = [
  // A group refers to its parent: one statement writes them all, so any order does.
  { table: categoryGroup, references: { parentId: categoryGroup } },
  { table: nature, references: {} },
  { table: balance, references: {} },
  { table: balanceNature, references: { balanceId: balance, natureId: nature } },
  { table: category, references: { groupId: categoryGroup, natureId: nature } },
  { table: subCategory, references: { categoryId: category } },
  { table: bookAccount, references: {} },
  { table: transfer, references: {} },
  { table: compensation, references: {} },
  { table: split, references: {} },
  { table: importBatch, references: { accountId: bookAccount } },
  {
    table: journalEntry,
    references: {
      accountId: bookAccount,
      subCategoryId: subCategory,
      transferId: transfer,
      compensationId: compensation,
      splitId: split,
      importBatchId: importBatch,
    },
  },
  { table: importRule, references: { subCategoryId: subCategory } },
  {
    table: importLine,
    references: {
      batchId: importBatch,
      subCategoryId: subCategory,
      ruleId: importRule,
      transferAccountId: bookAccount,
      entryId: journalEntry,
    },
  },
  { table: categoryBudget, references: { categoryId: category, accountId: bookAccount } },
  { table: budgetSettlement, references: { categoryId: category } },
];

/** Tables of a book written apart (languages) or never exported (members). */
export const APART: readonly PgTable[] = [bookLanguage, bookMember];

/**
 * Columns an export leaves out: the book it is, the revision (it starts again),
 * users of this installation, and schedules, which are not built yet.
 */
export const OMITTED = new Set(["bookId", "version", "createdBy", "scheduleId"]);

export function archivedColumns(table: PgTable): [string, PgColumn][] {
  return Object.entries(getTableColumns(table)).filter(([key]) => !OMITTED.has(key));
}

export const tableName = (table: PgTable) => getTableName(table);

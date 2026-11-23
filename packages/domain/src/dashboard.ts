import { z } from "zod";
import { MONTHS, budgetYearSchema } from "./budget.js";
import { entryDateSchema } from "./journal.js";
import type { Direction } from "./reference.js";

/** The year dashboard of a book: `today` tells which months are still ahead. */
export const dashboardQuerySchema = z.object({
  year: z.coerce.number().pipe(budgetYearSchema),
  today: entryDateSchema,
});

/**
 * The last month of `year` that is past or current at `today`: 12 for a past
 * year, 0 for a year that has not begun, the month number for the current one.
 */
export function currentMonthOf(year: number, today: string): number {
  const todayYear = Number(today.slice(0, 4));
  if (year < todayYear) return MONTHS;
  if (year > todayYear) return 0;
  return Number(today.slice(5, 7));
}

/**
 * What a periodic category's budget leaves for each month after the current
 * one: the month's own share not yet used by entries dated in it. It keeps
 * the sign of the allocation (a negative saving budget is a planned
 * withdrawal) and is 0 when the month's entries have used it up or gone past.
 * Months up to the current one show what was consumed, so they have none.
 */
export function unusedBudget(
  allocated: readonly bigint[],
  consumed: readonly bigint[],
  current: number,
): bigint[] {
  return allocated.map((share, index) => {
    if (index + 1 <= current) return 0n;
    const left = share - consumed[index]!;
    if (share >= 0n) return left > 0n ? left : 0n;
    return left < 0n ? left : 0n;
  });
}

/** The balance at the end of each month, from the opening balance and each month's change. */
export function monthEndBalances(opening: bigint, changes: readonly bigint[]): bigint[] {
  let balance = opening;
  return changes.map((change) => (balance += change));
}

// ---------------------------------------------------------------------------
// The rows of the grid
// ---------------------------------------------------------------------------

/** The reference data the rows are built from, each list already in display order. */
export interface DashboardStructure {
  groups: readonly { id: string }[];
  categories: readonly { id: string; groupId: string; direction: Direction }[];
  subCategories: readonly { id: string; categoryId: string }[];
}

/** What the entries of a sub-category hold in a month, in minor units of the book currency. */
export interface DashboardCell {
  subCategoryId: string;
  /** 1 to 12. */
  month: number;
  total: bigint;
}

/** A periodic budget's unused budget per month, signed like the entries. */
export interface DashboardUnused {
  categoryId: string;
  months: readonly bigint[];
}

export type DashboardRowKind = "group" | "category" | "sub" | "unused";

/**
 * A line of the grid. `id` is the id of the group, category or sub-category;
 * the "unused" line of a category carries the category's id. `parentId` is the
 * id of the enclosing group or category, so a page can fold the tree.
 */
export interface DashboardRow {
  kind: DashboardRowKind;
  id: string;
  parentId: string | null;
  depth: number;
  /** 12 monthly amounts, in minor units. */
  months: bigint[];
  total: bigint;
}

const zeros = () => Array<bigint>(MONTHS).fill(0n);

function addInto(target: bigint[], source: readonly bigint[]) {
  source.forEach((amount, index) => (target[index] = target[index]! + amount));
}

const totalOf = (months: readonly bigint[]) => months.reduce((a, b) => a + b, 0n);

/**
 * The rows of the year dashboard, in display order: a group, then its
 * categories, each followed by its sub-categories and, for a periodic
 * category, the line of its unused budget. A row is the sum of what it
 * contains. What has nothing in the year (no entry, no budget) is left out,
 * and so is a group left empty; transfers are not part of the dashboard.
 */
export function dashboardRows(
  structure: DashboardStructure,
  cells: readonly DashboardCell[],
  unused: readonly DashboardUnused[],
): DashboardRow[] {
  const bySub = new Map<string, bigint[]>();
  for (const cell of cells) {
    const months = bySub.get(cell.subCategoryId) ?? zeros();
    months[cell.month - 1] = months[cell.month - 1]! + cell.total;
    bySub.set(cell.subCategoryId, months);
  }
  const unusedOf = new Map(unused.map((u) => [u.categoryId, u.months]));

  const rows: DashboardRow[] = [];
  for (const group of structure.groups) {
    const groupMonths = zeros();
    const inGroup: DashboardRow[] = [];
    for (const category of structure.categories) {
      if (category.groupId !== group.id || category.direction === "transfer") continue;
      const categoryMonths = zeros();
      const inCategory: DashboardRow[] = [];
      for (const sub of structure.subCategories) {
        const months = bySub.get(sub.id);
        if (sub.categoryId !== category.id || !months) continue;
        addInto(categoryMonths, months);
        inCategory.push({
          kind: "sub",
          id: sub.id,
          parentId: category.id,
          depth: 2,
          months,
          total: totalOf(months),
        });
      }
      const budget = unusedOf.get(category.id);
      if (inCategory.length === 0 && !budget) continue;
      if (budget) {
        addInto(categoryMonths, budget);
        inCategory.push({
          kind: "unused",
          id: category.id,
          parentId: category.id,
          depth: 2,
          months: [...budget],
          total: totalOf(budget),
        });
      }
      addInto(groupMonths, categoryMonths);
      inGroup.push(
        {
          kind: "category",
          id: category.id,
          parentId: group.id,
          depth: 1,
          months: categoryMonths,
          total: totalOf(categoryMonths),
        },
        ...inCategory,
      );
    }
    if (inGroup.length === 0) continue;
    rows.push(
      {
        kind: "group",
        id: group.id,
        parentId: null,
        depth: 0,
        months: groupMonths,
        total: totalOf(groupMonths),
      },
      ...inGroup,
    );
  }
  return rows;
}

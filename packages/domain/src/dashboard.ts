import { z } from "zod";
import { MONTHS, budgetYearSchema } from "./budget.js";
import { entryDateSchema } from "./journal.js";
import type { NatureSign } from "./reference.js";

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
  /** Groups nest: `parentId` is the group this one belongs to, if any. */
  groups: readonly { id: string; parentId?: string | null }[];
  categories: readonly {
    id: string;
    groupId: string;
    /** Which nature the category belongs to; see `dashboardLines`. */
    natureId?: string;
  }[];
  subCategories: readonly { id: string; categoryId: string }[];
}

/** What the entries of a sub-category hold in a month, in minor units of the book currency. */
export interface DashboardCell {
  subCategoryId: string;
  /** 1 to 12. */
  month: number;
  total: bigint;
}

/** A category's budget lines per month, signed like the entries. */
export interface DashboardBudget {
  categoryId: string;
  months: readonly bigint[];
}

export type DashboardRowKind = "nature" | "balance" | "group" | "category" | "sub" | "budget";

/**
 * A line of the grid. `id` is the id of the group, category or sub-category;
 * the "budget" line of a category carries the category's id. `parentId` is the
 * id of the enclosing group or category, and `parentKind` which of the two it
 * is, so a page can fold the tree.
 */
export interface DashboardRow {
  /**
   * Unique in the dashboard, and what `parentKey` points at. A group that
   * carries categories of several natures appears once under each, so the
   * kind and id alone do not tell its rows apart.
   */
  key: string;
  parentKey: string | null;
  kind: DashboardRowKind;
  id: string;
  parentId: string | null;
  parentKind: "nature" | "group" | "category" | null;
  depth: number;
  /** One amount per column, in minor units: the 12 months, or the years of `yearlyLines`. */
  months: bigint[];
  total: bigint;
}

/** A row before it is given its keys. */
type BareRow = Omit<DashboardRow, "key" | "parentKey">;

/** Gives rows their keys; the groups of a nature's section are scoped to it. */
function withKeys(rows: readonly BareRow[], nature: string | null): DashboardRow[] {
  const keyOf = (kind: string, id: string) =>
    kind === "group" && nature ? `group:${id}@${nature}` : `${kind}:${id}`;
  return rows.map((row) => ({
    ...row,
    key: keyOf(row.kind, row.id),
    parentKey: row.parentId === null ? null : keyOf(row.parentKind!, row.parentId),
  }));
}

const zeros = (columns: number) => Array<bigint>(columns).fill(0n);

function addInto(target: bigint[], source: readonly bigint[]) {
  source.forEach((amount, index) => (target[index] = target[index]! + amount));
}

const totalOf = (months: readonly bigint[]) => months.reduce((a, b) => a + b, 0n);

/**
 * The rows of the year dashboard, in display order: a group, then its own
 * categories, each followed by its sub-categories and, when it has a
 * budget, its Budget line, then the groups nested in it, to
 * any depth. A row is the sum of what it contains. What has nothing in the
 * year (no entry, no budget) is left out, and so is a group left empty.
 */
export function dashboardRows(
  structure: DashboardStructure,
  cells: readonly DashboardCell[],
  budgets: readonly DashboardBudget[],
): DashboardRow[] {
  return withKeys(bareRows(structure, cells, budgets, MONTHS), null);
}

function bareRows(
  structure: DashboardStructure,
  cells: readonly DashboardCell[],
  budgets: readonly DashboardBudget[],
  columns: number,
): BareRow[] {
  const bySub = new Map<string, bigint[]>();
  for (const cell of cells) {
    const months = bySub.get(cell.subCategoryId) ?? zeros(columns);
    months[cell.month - 1] = months[cell.month - 1]! + cell.total;
    bySub.set(cell.subCategoryId, months);
  }
  const budgetOf = new Map(budgets.map((b) => [b.categoryId, b.months]));
  const known = new Set(structure.groups.map((g) => g.id));
  // A group whose parent is unknown is shown at the top.
  const isTop = (group: { parentId?: string | null }) =>
    !group.parentId || !known.has(group.parentId);
  // Groups pointing at each other (the API refuses it) are left out rather than looped on.
  const inProgress = new Set<string>();

  /** The rows of a group and of everything in it, with the group's months; none when empty. */
  function groupRows(
    group: { id: string },
    parent: string | null,
    depth: number,
  ): { rows: BareRow[]; months: bigint[] } {
    const groupMonths = zeros(columns);
    const inGroup: BareRow[] = [];
    if (inProgress.has(group.id)) return { rows: inGroup, months: groupMonths };
    inProgress.add(group.id);

    for (const category of structure.categories) {
      if (category.groupId !== group.id) continue;
      const categoryMonths = zeros(columns);
      const inCategory: BareRow[] = [];
      for (const sub of structure.subCategories) {
        const months = bySub.get(sub.id);
        if (sub.categoryId !== category.id || !months) continue;
        addInto(categoryMonths, months);
        inCategory.push({
          kind: "sub",
          id: sub.id,
          parentId: category.id,
          parentKind: "category",
          depth: depth + 2,
          months,
          total: totalOf(months),
        });
      }
      const budget = budgetOf.get(category.id);
      if (inCategory.length === 0 && !budget) continue;
      if (budget) {
        addInto(categoryMonths, budget);
        inCategory.push({
          kind: "budget",
          id: category.id,
          parentId: category.id,
          parentKind: "category",
          depth: depth + 2,
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
          parentKind: "group",
          depth: depth + 1,
          months: categoryMonths,
          total: totalOf(categoryMonths),
        },
        ...inCategory,
      );
    }

    for (const child of structure.groups) {
      if (child.parentId !== group.id) continue;
      const nested = groupRows(child, group.id, depth + 1);
      addInto(groupMonths, nested.months);
      inGroup.push(...nested.rows);
    }

    inProgress.delete(group.id);
    if (inGroup.length === 0) return { rows: [], months: groupMonths };
    return {
      rows: [
        {
          kind: "group",
          id: group.id,
          parentId: parent,
          parentKind: parent === null ? null : "group",
          depth,
          months: groupMonths,
          total: totalOf(groupMonths),
        },
        ...inGroup,
      ],
      months: groupMonths,
    };
  }

  return structure.groups.filter(isTop).flatMap((group) => groupRows(group, null, 0).rows);
}

// ---------------------------------------------------------------------------
// Natures and balances
// ---------------------------------------------------------------------------

/** The natures and balances of a book, which make up the top level of the dashboard. */
export interface DashboardLines {
  natures: readonly { id: string; transfer: boolean; sign: NatureSign; position: number }[];
  balances: readonly { id: string; natureIds: readonly string[]; position: number }[];
}

/** The natures and balances in the order the user set: they are one list. */
export function orderedLines(lines: DashboardLines): { kind: "nature" | "balance"; id: string }[] {
  const all = [
    ...lines.natures.map((n) => ({ kind: "nature" as const, id: n.id, at: n.position })),
    ...lines.balances.map((b) => ({ kind: "balance" as const, id: b.id, at: b.position })),
  ];
  // Array.sort is stable: on a tie, natures stay before balances.
  return all.sort((a, b) => a.at - b.at).map(({ kind, id }) => ({ kind, id }));
}

/**
 * The dashboard as the user ordered it: each nature with the groups,
 * categories and sub-categories that carry it, shown with the nature's sign
 * (spending reads as positive); each balance as the sum of the amounts as
 * entered of its natures, so display signs do not touch it. A nature with
 * nothing in the year is left out, and so is a balance none of whose natures
 * has anything. Transfers are not shown. A balance placed before one of its
 * natures still adds it up.
 */
export function dashboardLines(
  structure: DashboardStructure,
  lines: DashboardLines,
  cells: readonly DashboardCell[],
  budgets: readonly DashboardBudget[],
  columns: number = MONTHS,
): DashboardRow[] {
  const shown = new Map<string, { rows: DashboardRow[]; raw: bigint[] }>();
  for (const nature of lines.natures) {
    if (nature.transfer) continue;
    const rows = bareRows(
      { ...structure, categories: structure.categories.filter((c) => c.natureId === nature.id) },
      cells,
      budgets,
      columns,
    );
    if (rows.length === 0) continue;
    const raw = zeros(columns);
    for (const row of rows) if (row.depth === 0) addInto(raw, row.months);
    const sign = BigInt(nature.sign);
    shown.set(nature.id, {
      raw,
      rows: withKeys(
        [
          {
            kind: "nature",
            id: nature.id,
            parentId: null,
            parentKind: null,
            depth: 0,
            months: raw.map((m) => m * sign),
            total: totalOf(raw) * sign,
          },
          ...rows.map((row) => ({
            ...row,
            parentId: row.parentId ?? nature.id,
            parentKind: row.parentKind ?? ("nature" as const),
            depth: row.depth + 1,
            months: row.months.map((m) => m * sign),
            total: row.total * sign,
          })),
        ],
        nature.id,
      ),
    });
  }

  const balances = new Map(lines.balances.map((b) => [b.id, b]));
  return orderedLines(lines).flatMap(({ kind, id }): DashboardRow[] => {
    if (kind === "nature") return shown.get(id)?.rows ?? [];
    const parts = balances
      .get(id)!
      .natureIds.map((n) => shown.get(n))
      .filter((part) => part !== undefined);
    if (parts.length === 0) return [];
    const months = zeros(columns);
    for (const part of parts) addInto(months, part.raw);
    return withKeys(
      [
        {
          kind: "balance",
          id,
          parentId: null,
          parentKind: null,
          depth: 0,
          months,
          total: totalOf(months),
        },
      ],
      null,
    );
  });
}

// ---------------------------------------------------------------------------
// Year by year
// ---------------------------------------------------------------------------

/** What the entries of a sub-category hold in a budget year. */
export interface YearCell {
  subCategoryId: string;
  year: number;
  total: bigint;
}

/** What a category's budget lines of a year hold, signed like the entries. */
export interface YearBudget {
  categoryId: string;
  year: number;
  total: bigint;
}

/**
 * `dashboardLines` with one column per year instead of per month: `months`
 * holds an amount per year of `years`, in that order. What belongs to another
 * year is left out, and with it the rows that hold nothing in `years`.
 */
export function yearlyLines(
  structure: DashboardStructure,
  lines: DashboardLines,
  cells: readonly YearCell[],
  budgets: readonly YearBudget[],
  years: readonly number[],
): DashboardRow[] {
  const columnOf = new Map(years.map((year, index) => [year, index]));
  const columnCells = cells.flatMap(({ subCategoryId, year, total }) => {
    const column = columnOf.get(year);
    return column === undefined ? [] : [{ subCategoryId, month: column + 1, total }];
  });
  const byCategory = new Map<string, bigint[]>();
  for (const { categoryId, year, total } of budgets) {
    const column = columnOf.get(year);
    if (column === undefined) continue;
    const amounts = byCategory.get(categoryId) ?? zeros(years.length);
    amounts[column] = amounts[column]! + total;
    byCategory.set(categoryId, amounts);
  }
  return dashboardLines(
    structure,
    lines,
    columnCells,
    [...byCategory].map(([categoryId, months]) => ({ categoryId, months })),
    years.length,
  );
}

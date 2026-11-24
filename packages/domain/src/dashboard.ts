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

/** A periodic budget's unused budget per month, signed like the entries. */
export interface DashboardUnused {
  categoryId: string;
  months: readonly bigint[];
}

export type DashboardRowKind = "nature" | "balance" | "group" | "category" | "sub" | "unused";

/**
 * A line of the grid. `id` is the id of the group, category or sub-category;
 * the "unused" line of a category carries the category's id. `parentId` is the
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
  /** 12 monthly amounts, in minor units. */
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

const zeros = () => Array<bigint>(MONTHS).fill(0n);

function addInto(target: bigint[], source: readonly bigint[]) {
  source.forEach((amount, index) => (target[index] = target[index]! + amount));
}

const totalOf = (months: readonly bigint[]) => months.reduce((a, b) => a + b, 0n);

/**
 * The rows of the year dashboard, in display order: a group, then its own
 * categories, each followed by its sub-categories and, for a periodic
 * category, the line of its unused budget, then the groups nested in it, to
 * any depth. A row is the sum of what it contains. What has nothing in the
 * year (no entry, no budget) is left out, and so is a group left empty.
 */
export function dashboardRows(
  structure: DashboardStructure,
  cells: readonly DashboardCell[],
  unused: readonly DashboardUnused[],
): DashboardRow[] {
  return withKeys(bareRows(structure, cells, unused), null);
}

function bareRows(
  structure: DashboardStructure,
  cells: readonly DashboardCell[],
  unused: readonly DashboardUnused[],
): BareRow[] {
  const bySub = new Map<string, bigint[]>();
  for (const cell of cells) {
    const months = bySub.get(cell.subCategoryId) ?? zeros();
    months[cell.month - 1] = months[cell.month - 1]! + cell.total;
    bySub.set(cell.subCategoryId, months);
  }
  const unusedOf = new Map(unused.map((u) => [u.categoryId, u.months]));
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
    const groupMonths = zeros();
    const inGroup: BareRow[] = [];
    if (inProgress.has(group.id)) return { rows: inGroup, months: groupMonths };
    inProgress.add(group.id);

    for (const category of structure.categories) {
      if (category.groupId !== group.id) continue;
      const categoryMonths = zeros();
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
      const budget = unusedOf.get(category.id);
      if (inCategory.length === 0 && !budget) continue;
      if (budget) {
        addInto(categoryMonths, budget);
        inCategory.push({
          kind: "unused",
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
  unused: readonly DashboardUnused[],
): DashboardRow[] {
  const shown = new Map<string, { rows: DashboardRow[]; raw: bigint[] }>();
  for (const nature of lines.natures) {
    if (nature.transfer) continue;
    const rows = bareRows(
      { ...structure, categories: structure.categories.filter((c) => c.natureId === nature.id) },
      cells,
      unused,
    );
    if (rows.length === 0) continue;
    const raw = zeros();
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
    const months = zeros();
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

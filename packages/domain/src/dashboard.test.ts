import { describe, expect, it } from "vitest";
import {
  currentMonthOf,
  dashboardRows,
  monthEndBalances,
  unusedBudget,
  type DashboardStructure,
} from "./dashboard.js";

describe("currentMonthOf", () => {
  it("is the month for the current year, 12 for a past year and 0 for a future one", () => {
    expect(currentMonthOf(2026, "2026-11-23")).toBe(11);
    expect(currentMonthOf(2025, "2026-11-23")).toBe(12);
    expect(currentMonthOf(2027, "2026-11-23")).toBe(0);
  });
});

describe("unusedBudget", () => {
  const allocated = Array<bigint>(12).fill(100n);

  it("is the month's share not yet used, for the months after the current one", () => {
    const consumed = Array<bigint>(12).fill(0n);
    consumed[10] = 30n; // November, current
    consumed[11] = 40n; // December, an entry already known
    const unused = unusedBudget(allocated, consumed, 11);
    expect(unused.slice(0, 11)).toEqual(Array(11).fill(0n));
    expect(unused[11]).toBe(60n);
  });

  it("is 0 once the entries of a future month have used up its share", () => {
    const consumed = Array<bigint>(12).fill(0n);
    consumed[11] = 150n;
    expect(unusedBudget(allocated, consumed, 11)[11]).toBe(0n);
  });

  it("is the whole share for every month of a year not begun, and nothing for a past year", () => {
    const none = Array<bigint>(12).fill(0n);
    expect(unusedBudget(allocated, none, 0)).toEqual(allocated);
    expect(unusedBudget(allocated, none, 12)).toEqual(none);
  });

  it("keeps the sign of a negative allocation, a planned withdrawal", () => {
    const withdrawal = Array<bigint>(12).fill(-100n);
    const none = Array<bigint>(12).fill(0n);
    expect(unusedBudget(withdrawal, none, 0)[0]).toBe(-100n);
  });
});

describe("monthEndBalances", () => {
  it("adds each month's change to the opening balance", () => {
    const changes = Array<bigint>(12).fill(0n);
    changes[0] = 500n;
    changes[2] = -200n;
    expect(monthEndBalances(1_000n, changes)).toEqual([
      1_500n,
      1_500n,
      1_300n,
      ...Array<bigint>(9).fill(1_300n),
    ]);
  });
});

describe("dashboardRows", () => {
  const structure: DashboardStructure = {
    groups: [{ id: "g-daily" }, { id: "g-empty" }, { id: "g-transfers" }],
    categories: [
      { id: "c-food", groupId: "g-daily", direction: "expense" },
      { id: "c-pay", groupId: "g-daily", direction: "income" },
      { id: "c-unused", groupId: "g-empty", direction: "expense" },
      { id: "c-move", groupId: "g-transfers", direction: "transfer" },
    ],
    subCategories: [
      { id: "s-bread", categoryId: "c-food" },
      { id: "s-meat", categoryId: "c-food" },
      { id: "s-pay", categoryId: "c-pay" },
      { id: "s-move", categoryId: "c-move" },
    ],
  };
  const cell = (subCategoryId: string, month: number, total: bigint) => ({
    subCategoryId,
    month,
    total,
  });

  it("lists groups, categories and sub-categories in order, each the sum of its content", () => {
    const rows = dashboardRows(
      structure,
      [cell("s-bread", 1, -10n), cell("s-meat", 1, -20n), cell("s-bread", 2, -5n)],
      [],
    );
    expect(rows.map((r) => [r.kind, r.id, r.depth])).toEqual([
      ["group", "g-daily", 0],
      ["category", "c-food", 1],
      ["sub", "s-bread", 2],
      ["sub", "s-meat", 2],
    ]);
    const group = rows[0]!;
    expect(group.months.slice(0, 3)).toEqual([-30n, -5n, 0n]);
    expect(group.total).toBe(-35n);
    expect(rows[1]!.parentId).toBe("g-daily");
    expect(rows[2]!.parentId).toBe("c-food");
  });

  it("hides what has nothing in the year, an empty group included", () => {
    const rows = dashboardRows(structure, [cell("s-pay", 3, 1_000n)], []);
    expect(rows.map((r) => r.id)).toEqual(["g-daily", "c-pay", "s-pay"]);
  });

  it("leaves transfers out", () => {
    const rows = dashboardRows(structure, [cell("s-move", 1, 500n)], []);
    expect(rows).toEqual([]);
  });

  it("keeps an entry row whose months add up to zero", () => {
    const rows = dashboardRows(structure, [cell("s-bread", 1, 10n), cell("s-bread", 2, -10n)], []);
    expect(rows.map((r) => r.id)).toContain("s-bread");
  });

  it("adds the unused budget of a periodic category as a line that completes the category", () => {
    const unused = Array<bigint>(12).fill(0n);
    unused[10] = -100n;
    unused[11] = -100n;
    const rows = dashboardRows(
      structure,
      [cell("s-bread", 11, -30n)],
      [{ categoryId: "c-food", months: unused }],
    );
    expect(rows.map((r) => [r.kind, r.id])).toEqual([
      ["group", "g-daily"],
      ["category", "c-food"],
      ["sub", "s-bread"],
      ["unused", "c-food"],
    ]);
    const category = rows[1]!;
    expect(category.months[10]).toBe(-130n);
    expect(category.months[11]).toBe(-100n);
    expect(category.total).toBe(-230n);
    expect(rows[0]!.total).toBe(-230n);
  });

  it("shows a category that has a budget and no entry", () => {
    const unused = Array<bigint>(12).fill(-50n);
    const rows = dashboardRows(structure, [], [{ categoryId: "c-unused", months: unused }]);
    expect(rows.map((r) => [r.kind, r.id])).toEqual([
      ["group", "g-empty"],
      ["category", "c-unused"],
      ["unused", "c-unused"],
    ]);
    expect(rows[0]!.total).toBe(-600n);
  });
});

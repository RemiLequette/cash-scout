import { describe, expect, it } from "vitest";
import {
  currentMonthOf,
  dashboardLines,
  dashboardRows,
  orderedLines,
  type DashboardLines,
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

describe("dashboardRows with nested groups", () => {
  const structure: DashboardStructure = {
    groups: [
      { id: "assets" },
      { id: "rennes", parentId: "assets" },
      { id: "maisons", parentId: "assets" },
      { id: "empty", parentId: "assets" },
      { id: "daily" },
    ],
    categories: [
      { id: "rent", groupId: "rennes", direction: "income" },
      { id: "loan", groupId: "rennes", direction: "expense" },
      { id: "tax", groupId: "assets", direction: "expense" },
      { id: "house", groupId: "maisons", direction: "income" },
      { id: "food", groupId: "daily", direction: "expense" },
    ],
    subCategories: [
      { id: "s-rent", categoryId: "rent" },
      { id: "s-loan", categoryId: "loan" },
      { id: "s-tax", categoryId: "tax" },
      { id: "s-house", categoryId: "house" },
      { id: "s-food", categoryId: "food" },
    ],
  };
  const cell = (subCategoryId: string, month: number, total: bigint) => ({
    subCategoryId,
    month,
    total,
  });
  const all = [
    cell("s-rent", 1, 1_000n),
    cell("s-loan", 1, -400n),
    cell("s-tax", 1, -50n),
    cell("s-house", 2, 300n),
    cell("s-food", 1, -20n),
  ];

  it("puts a group's own categories first, then the groups nested in it, to any depth", () => {
    const rows = dashboardRows(structure, all, []);
    expect(rows.map((r) => [r.kind, r.id, r.depth])).toEqual([
      ["group", "assets", 0],
      ["category", "tax", 1],
      ["sub", "s-tax", 2],
      ["group", "rennes", 1],
      ["category", "rent", 2],
      ["sub", "s-rent", 3],
      ["category", "loan", 2],
      ["sub", "s-loan", 3],
      ["group", "maisons", 1],
      ["category", "house", 2],
      ["sub", "s-house", 3],
      ["group", "daily", 0],
      ["category", "food", 1],
      ["sub", "s-food", 2],
    ]);
  });

  it("tells each row's parent and its kind", () => {
    const rows = dashboardRows(structure, all, []);
    const parent = (id: string, kind: string) => {
      const row = rows.find((r) => r.id === id && r.kind === kind)!;
      return [row.parentId, row.parentKind];
    };
    expect(parent("assets", "group")).toEqual([null, null]);
    expect(parent("rennes", "group")).toEqual(["assets", "group"]);
    expect(parent("rent", "category")).toEqual(["rennes", "group"]);
    expect(parent("s-rent", "sub")).toEqual(["rent", "category"]);
  });

  it("makes a group the sum of its categories and of its nested groups", () => {
    const rows = dashboardRows(structure, all, []);
    const total = (id: string) => rows.find((r) => r.kind === "group" && r.id === id)!.total;
    expect(total("rennes")).toBe(600n);
    expect(total("maisons")).toBe(300n);
    expect(total("assets")).toBe(600n + 300n - 50n);
    expect(rows.find((r) => r.id === "assets")!.months.slice(0, 2)).toEqual([550n, 300n]);
  });

  it("hides a nested group with nothing in it, and a parent left with only empty ones", () => {
    const rows = dashboardRows(structure, [cell("s-food", 1, -20n)], []);
    expect(rows.map((r) => r.id)).toEqual(["daily", "food", "s-food"]);
  });

  it("does not loop on groups that point at each other", () => {
    const loop: DashboardStructure = {
      groups: [{ id: "a", parentId: "b" }, { id: "b", parentId: "a" }, { id: "c" }],
      categories: [{ id: "k", groupId: "c", direction: "expense" }],
      subCategories: [{ id: "s", categoryId: "k" }],
    };
    expect(dashboardRows(loop, [cell("s", 1, -5n)], []).map((r) => r.id)).toEqual(["c", "k", "s"]);
  });
});

describe("dashboardLines", () => {
  const structure: DashboardStructure = {
    groups: [{ id: "daily" }, { id: "work" }, { id: "big" }],
    categories: [
      { id: "food", groupId: "daily", direction: "expense", natureId: "spend" },
      { id: "pay", groupId: "work", direction: "income", natureId: "earn" },
      { id: "roof", groupId: "big", direction: "expense", natureId: "once" },
      { id: "move", groupId: "daily", direction: "transfer", natureId: "xfer" },
    ],
    subCategories: [
      { id: "s-food", categoryId: "food" },
      { id: "s-pay", categoryId: "pay" },
      { id: "s-roof", categoryId: "roof" },
      { id: "s-move", categoryId: "move" },
    ],
  };
  const lines: DashboardLines = {
    natures: [
      { id: "earn", behavior: "income", sign: 1, position: 0 },
      { id: "spend", behavior: "expense", sign: -1, position: 1 },
      { id: "once", behavior: "expense", sign: -1, position: 3 },
      { id: "xfer", behavior: "transfer", sign: 1, position: 5 },
    ],
    balances: [
      { id: "current", natureIds: ["earn", "spend"], position: 2 },
      { id: "total", natureIds: ["earn", "spend", "once"], position: 4 },
    ],
  };
  const cell = (subCategoryId: string, month: number, total: bigint) => ({
    subCategoryId,
    month,
    total,
  });
  const all = [
    cell("s-pay", 1, 1_000n),
    cell("s-food", 1, -300n),
    cell("s-roof", 2, -500n),
    cell("s-move", 1, 99n),
  ];

  it("follows the user's order, mixing natures and balances", () => {
    const rows = dashboardLines(structure, lines, all, []);
    expect(rows.filter((r) => r.depth === 0).map((r) => [r.kind, r.id])).toEqual([
      ["nature", "earn"],
      ["nature", "spend"],
      ["balance", "current"],
      ["nature", "once"],
      ["balance", "total"],
    ]);
  });

  it("shows a nature with its sign, so spending reads as positive", () => {
    const rows = dashboardLines(structure, lines, all, []);
    const spend = rows.find((r) => r.kind === "nature" && r.id === "spend")!;
    expect(spend.months[0]).toBe(300n);
    const food = rows.find((r) => r.kind === "sub" && r.id === "s-food")!;
    expect(food.months[0]).toBe(300n);
    expect(food.depth).toBe(3);
    const group = rows.find((r) => r.kind === "group" && r.id === "daily")!;
    expect([group.parentKind, group.parentId, group.depth]).toEqual(["nature", "spend", 1]);
  });

  it("adds a balance up from the amounts as entered, ignoring display signs", () => {
    const rows = dashboardLines(structure, lines, all, []);
    expect(rows.find((r) => r.kind === "balance" && r.id === "current")!.months[0]).toBe(700n);
    const total = rows.find((r) => r.kind === "balance" && r.id === "total")!;
    expect(total.months.slice(0, 2)).toEqual([700n, -500n]);
    expect(total.total).toBe(200n);
  });

  it("leaves out transfers and what has nothing in the year", () => {
    expect(dashboardLines(structure, lines, [cell("s-move", 1, 99n)], [])).toEqual([]);
  });

  it("gives each row a unique key, a group shared by two natures included", () => {
    const shared: DashboardStructure = {
      groups: [{ id: "home" }],
      categories: [
        { id: "rent", groupId: "home", direction: "expense", natureId: "spend" },
        { id: "roof", groupId: "home", direction: "expense", natureId: "once" },
      ],
      subCategories: [
        { id: "s-rent", categoryId: "rent" },
        { id: "s-roof", categoryId: "roof" },
      ],
    };
    const rows = dashboardLines(
      shared,
      lines,
      [cell("s-rent", 1, -10n), cell("s-roof", 1, -5n)],
      [],
    );
    const keys = rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    const homes = rows.filter((r) => r.kind === "group");
    expect(homes.map((r) => [r.key, r.parentKey])).toEqual([
      ["group:home@spend", "nature:spend"],
      ["group:home@once", "nature:once"],
    ]);
    const roof = rows.find((r) => r.kind === "category" && r.id === "roof")!;
    expect(roof.parentKey).toBe("group:home@once");
  });

  it("still adds up natures that come after the balance", () => {
    const early: DashboardLines = {
      ...lines,
      balances: [{ id: "first", natureIds: ["earn", "spend"], position: -1 }],
    };
    const rows = dashboardLines(structure, early, all, []);
    expect(rows[0]).toMatchObject({ kind: "balance", id: "first" });
    expect(rows[0]!.months[0]).toBe(700n);
  });
});

describe("orderedLines", () => {
  it("sorts natures and balances on one position scale, natures first on a tie", () => {
    const order = orderedLines({
      natures: [
        { id: "n1", behavior: "income", sign: 1, position: 1 },
        { id: "n0", behavior: "expense", sign: -1, position: 0 },
      ],
      balances: [{ id: "b", natureIds: ["n0"], position: 1 }],
    });
    expect(order.map((l) => l.id)).toEqual(["n0", "n1", "b"]);
  });
});

import { describe, expect, it } from "vitest";
import { decide, matchLines, type LineDecision } from "./review.js";

const line = (id: string, date: string, amount: bigint) => ({ id, date, amount });
const entry = (id: string, date: string, amount: bigint, reconciled = false) => ({
  id,
  date,
  amount,
  reconciled,
});

describe("matchLines", () => {
  it("proposes entries of the same amount within the window, the closest first", () => {
    const matches = matchLines(
      [line("l", "2026-11-10", -500n)],
      [
        entry("far", "2026-11-14", -500n),
        entry("near", "2026-11-09", -500n),
        entry("late", "2026-11-16", -500n),
        entry("other", "2026-11-10", -501n),
      ],
    );
    expect(matches.get("l")).toEqual(["near", "far"]);
  });

  it("gives an entry to one line only, the closest", () => {
    const matches = matchLines(
      [line("a", "2026-11-08", -320n), line("b", "2026-11-10", -320n)],
      [entry("e", "2026-11-10", -320n)],
    );
    expect([...matches]).toEqual([["b", ["e"]]]);
  });

  it("prefers a forecast to a reconciled entry at the same distance", () => {
    const matches = matchLines(
      [line("l", "2026-11-10", 100n)],
      [entry("done", "2026-11-10", 100n, true), entry("planned", "2026-11-10", 100n)],
    );
    expect(matches.get("l")?.[0]).toBe("planned");
  });
});

describe("decide", () => {
  const fresh: LineDecision = { status: "review", subCategoryId: null, entryId: null };

  it("validates a line when a sub-category or an entry is chosen", () => {
    const sub = decide(fresh, { subCategoryId: "s" });
    expect(sub).toEqual({ status: "validated", subCategoryId: "s", entryId: null });
    expect(decide(sub, { entryId: "e" })).toEqual({
      status: "validated",
      subCategoryId: null,
      entryId: "e",
    });
    expect(decide(sub, { subCategoryId: null })).toEqual(fresh);
  });

  it("keeps the choice of an ignored line", () => {
    const ignored = decide({ ...fresh, subCategoryId: "s" }, { status: "ignored" });
    expect(ignored).toEqual({ status: "ignored", subCategoryId: "s", entryId: null });
  });

  it("refuses to validate nothing and to change an imported line", () => {
    expect(() => decide(fresh, { status: "validated" })).toThrow(RangeError);
    expect(() => decide({ ...fresh, status: "imported" }, { status: "ignored" })).toThrow(
      RangeError,
    );
  });
});

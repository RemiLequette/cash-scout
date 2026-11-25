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
  const reconciled = (id: string, date: string, amount: bigint) => entry(id, date, amount, true);

  it("proposes a reconciled entry of the same amount within five days, the closest first", () => {
    const matches = matchLines(
      [line("l", "2026-11-10", -500n)],
      [
        reconciled("far", "2026-11-14", -500n),
        reconciled("near", "2026-11-09", -500n),
        reconciled("late", "2026-11-16", -500n),
        reconciled("other", "2026-11-10", -501n),
      ],
    );
    expect(matches.get("l")).toEqual(["near", "far"]);
  });

  it("proposes a forecast within ten days and ten percent of its amount", () => {
    const l = [line("l", "2026-11-10", -12743n)];
    expect(matchLines(l, [entry("bill", "2026-11-01", -12000n)]).get("l")).toEqual(["bill"]);
    expect(matchLines(l, [entry("old", "2026-10-30", -12743n)]).size).toBe(0);
    expect(matchLines(l, [entry("cheap", "2026-11-10", -11000n)]).size).toBe(0);
    expect(matchLines(l, [entry("refund", "2026-11-10", 12743n)]).size).toBe(0);
  });

  it("prefers the exact amount to a closer date", () => {
    const matches = matchLines(
      [line("l", "2026-11-10", -1000n)],
      [entry("close", "2026-11-10", -1050n), entry("exact", "2026-11-03", -1000n)],
    );
    expect(matches.get("l")?.[0]).toBe("exact");
  });

  it("needs the exact amount of a side of a transfer", () => {
    const transfer = { ...entry("side", "2026-11-10", -50000n), transfer: true };
    expect(matchLines([line("l", "2026-11-10", -50100n)], [transfer]).size).toBe(0);
    expect(matchLines([line("l", "2026-11-18", -50000n)], [transfer]).size).toBe(1);
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
      [reconciled("done", "2026-11-10", 100n), entry("planned", "2026-11-10", 100n)],
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

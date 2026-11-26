import { describe, expect, it } from "vitest";
import { entriesToCopy, scheduleDates, yearAhead } from "./plan.js";

describe("yearAhead", () => {
  it("keeps the day, 29 February becoming 28", () => {
    expect(yearAhead("2026-03-15")).toBe("2027-03-15");
    expect(yearAhead("2028-02-29")).toBe("2029-02-28");
  });
});

describe("scheduleDates", () => {
  it("repeats every few months on the same day", () => {
    expect(scheduleDates("2027-02-05", "2027-12-31", 3)).toEqual([
      "2027-02-05",
      "2027-05-05",
      "2027-08-05",
      "2027-11-05",
    ]);
  });

  it("takes the last day of a shorter month, then returns to the day", () => {
    expect(scheduleDates("2027-01-31", "2027-04-30", 1)).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
    ]);
  });

  it("is empty when the last date is before the first", () => {
    expect(scheduleDates("2027-05-01", "2027-04-01", 1)).toEqual([]);
  });
});

describe("entriesToCopy", () => {
  const rent = { date: "2026-01-05", subCategoryId: "s", description: "Loyer" };

  it("moves what is not there yet a year later", () => {
    expect(entriesToCopy([rent], [])).toEqual([{ ...rent, date: "2027-01-05" }]);
    expect(entriesToCopy([rent], [{ ...rent, date: "2027-01-05" }])).toEqual([]);
  });

  it("counts entries alike one for one", () => {
    const copies = entriesToCopy([rent, rent], [{ ...rent, date: "2027-01-05" }]);
    expect(copies).toHaveLength(1);
  });
});

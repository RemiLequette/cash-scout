import { describe, expect, it } from "vitest";
import { balanceSeries, overdrafts } from "./projection.js";

const from = "2026-11-01";
const to = "2027-02-28";

describe("balanceSeries", () => {
  it("starts from the opening balance and steps on the days that change it", () => {
    const series = balanceSeries(
      10_000n,
      [
        { date: "2026-11-15", amount: -2_500n },
        { date: "2026-12-01", amount: 500n },
      ],
      from,
      to,
    );
    expect(series).toEqual([
      { date: from, balance: 10_000n },
      { date: "2026-11-15", balance: 7_500n },
      { date: "2026-12-01", balance: 8_000n },
    ]);
  });

  it("folds a change of the first day into the opening point", () => {
    const series = balanceSeries(100n, [{ date: from, amount: 50n }], from, to);
    expect(series).toEqual([{ date: from, balance: 150n }]);
  });

  it("sorts the changes and leaves out those outside the window", () => {
    const series = balanceSeries(
      0n,
      [
        { date: "2027-03-01", amount: 9n },
        { date: "2026-12-10", amount: 2n },
        { date: "2026-10-31", amount: 7n },
        { date: "2026-11-05", amount: 1n },
      ],
      from,
      to,
    );
    expect(series.map((p) => p.balance)).toEqual([0n, 1n, 3n]);
  });
});

describe("overdrafts", () => {
  it("finds none when the balance stays at zero or more", () => {
    expect(overdrafts(balanceSeries(0n, [{ date: "2026-11-02", amount: 5n }], from, to))).toEqual(
      [],
    );
  });

  it("gives each stretch below zero with its lowest point", () => {
    const series = balanceSeries(
      100n,
      [
        { date: "2026-11-10", amount: -150n }, // -50
        { date: "2026-11-20", amount: -100n }, // -150
        { date: "2026-12-01", amount: 300n }, // 150
        { date: "2027-01-05", amount: -200n }, // -50, to the end
      ],
      from,
      to,
    );
    expect(overdrafts(series)).toEqual([
      { from: "2026-11-10", until: "2026-12-01", lowest: -150n, lowestDate: "2026-11-20" },
      { from: "2027-01-05", until: null, lowest: -50n, lowestDate: "2027-01-05" },
    ]);
  });

  it("sees an account that opens overdrawn", () => {
    expect(overdrafts(balanceSeries(-10n, [], from, to))).toEqual([
      { from, until: null, lowest: -10n, lowestDate: from },
    ]);
  });
});

import { describe, expect, it } from "vitest";
import {
  addMonths,
  annuity,
  checkCapital,
  effectiveRates,
  insuranceLines,
  penaltyLines,
  loanEventInputSchema,
  loanInputSchema,
  loanSchedule,
  matchPayments,
  paidLines,
  remainingCapital,
  type LoanEvent,
  type LoanTerms,
} from "./loan.js";

/** 120 000.00 over 20 years at 3 %: a constant payment of 665.52. */
const loan = (changes: Partial<LoanTerms> = {}): LoanTerms => ({
  amount: 12_000_000n,
  rate: "3",
  term: 240,
  start: "2026-01-05",
  insuranceMode: "none",
  insuranceRate: "0",
  insuranceSeparate: false,
  insuranceAccountId: null,
  deferralMode: "none",
  deferralMonths: 0,
  ...changes,
});

const event = (
  date: string,
  kind: LoanEvent["kind"],
  amount: bigint | null = null,
  keeps: LoanEvent["keeps"] = "payment",
): LoanEvent => ({ date, kind, amount, keeps });

const total = (values: bigint[]) => values.reduce((sum, value) => sum + value, 0n);

describe("loan schedule", () => {
  it("repays a constant payment, the last one taking what is left", () => {
    const lines = loanSchedule(loan(), []);
    expect(lines).toHaveLength(240);
    expect(annuity(12_000_000n, 0.0025, 240)).toBe(66_552n);
    expect(lines[0]).toMatchObject({
      date: "2026-01-05",
      number: 1,
      interest: 30_000n,
      capital: 36_552n,
      total: 66_552n,
      remaining: 11_963_448n,
    });
    expect(lines.slice(0, -1).every((line) => line.total === 66_552n)).toBe(true);
    expect(Math.abs(Number(lines.at(-1)!.total - 66_552n))).toBeLessThan(200);
    expect(lines.at(-1)!.remaining).toBe(0n);
    expect(total(lines.map((line) => line.capital))).toBe(12_000_000n);
  });

  it("splits a loan without interest evenly", () => {
    const lines = loanSchedule(loan({ rate: "0", amount: 1_000n, term: 3 }), []);
    expect(lines.map((line) => line.capital)).toEqual([333n, 333n, 334n]);
  });

  it("keeps the day of the month, or the last day of a shorter one", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-01-31", 2)).toBe("2026-03-31");
    expect(addMonths("2026-11-15", 2)).toBe("2027-01-15");
  });

  it("insures the capital borrowed, or the capital left", () => {
    const initial = loanSchedule(loan({ insuranceMode: "initial", insuranceRate: "0.36" }), []);
    expect(initial[0]!.insurance).toBe(3_600n);
    expect(initial[100]!.insurance).toBe(3_600n);
    expect(initial[0]!.total).toBe(66_552n + 3_600n);

    const left = loanSchedule(loan({ insuranceMode: "remaining", insuranceRate: "0.36" }), []);
    expect(left[0]!.insurance).toBe(3_600n);
    expect(left[1]!.insurance).toBe(3_589n);
    expect(left.at(-1)!.insurance).toBeLessThan(25n);
  });

  it("changes insurer from a date, on the payments of that day on", () => {
    const terms = loan({ insuranceMode: "initial", insuranceRate: "0.36" });
    const change: LoanEvent = {
      ...event("2026-03-05", "insurance"),
      insuranceMode: "remaining",
      insuranceRate: "0.20",
    };
    const lines = loanSchedule(terms, [change]);
    const payments = lines.filter((line) => line.kind === "payment");
    expect(payments[1]!.insurance).toBe(3_600n);
    expect(payments[2]!.insurance).toBe(1_988n);
    expect(lines.map((line) => line.kind).slice(0, 4)).toEqual([
      "payment",
      "payment",
      "insurance",
      "payment",
    ]);
    // Without insurance from then on.
    const none = loanSchedule(terms, [{ ...change, insuranceMode: "none" }]);
    expect(none.filter((line) => line.kind === "payment")[2]!.insurance).toBe(0n);
  });

  it("keeps a separate insurance out of the payment, on its own account", () => {
    const terms = loan({
      insuranceMode: "initial",
      insuranceRate: "0.36",
      insuranceSeparate: true,
    });
    const lines = loanSchedule(terms, [
      {
        ...event("2026-06-01", "insurance"),
        insuranceMode: "remaining",
        insuranceRate: "0.30",
        insuranceSeparate: true,
        insuranceAccountId: "other",
      },
    ]);
    expect(lines[0]).toMatchObject({ insurance: 3_600n, total: 66_552n, insuranceAccountId: null });
    expect(lines.filter((line) => line.kind === "payment")[5]).toMatchObject({
      insuranceSeparate: true,
      insuranceAccountId: "other",
    });
    expect(insuranceLines(lines)).toHaveLength(240);
    // Back in the payment with a new insurer.
    const back = loanSchedule(terms, [
      { ...event("2026-02-01", "insurance"), insuranceMode: "initial", insuranceRate: "0.30" },
    ]);
    expect(back.filter((line) => line.kind === "payment")[1]).toMatchObject({
      insuranceSeparate: false,
      total: 66_552n + 3_000n,
    });
  });

  it("carries the penalty of a repayment or a buy-back apart from the capital", () => {
    for (const kind of ["repayment", "buyback"] as const) {
      const lines = loanSchedule(loan(), [{ ...event("2026-02-10", kind), penalty: 90_000n }]);
      const last = lines.at(-1)!;
      expect(last).toMatchObject({ kind, penalty: 90_000n, remaining: 0n });
      expect(last.total).toBe(last.capital);
      expect(penaltyLines(lines)).toHaveLength(1);
    }
    expect(penaltyLines(loanSchedule(loan(), []))).toHaveLength(0);
  });

  it("pays the interest only during a deferral, then repays over what is left", () => {
    const lines = loanSchedule(loan({ deferralMode: "interest", deferralMonths: 12 }), []);
    expect(lines).toHaveLength(240);
    expect(lines.slice(0, 12).every((l) => l.capital === 0n && l.total === 30_000n)).toBe(true);
    expect(lines[12]!.total).toBe(annuity(12_000_000n, 0.0025, 228));
    expect(lines.at(-1)!.remaining).toBe(0n);
  });

  it("adds the interest to the capital when nothing is paid", () => {
    const terms = loan({
      deferralMode: "total",
      deferralMonths: 2,
      insuranceMode: "initial",
      insuranceRate: "0.36",
    });
    const lines = loanSchedule(terms, []);
    expect(lines[0]).toMatchObject({ total: 0n, interest: 30_000n, remaining: 12_030_000n });
    expect(lines[1]!.remaining).toBe(12_060_075n);
    expect(lines[2]!.total).toBe(annuity(12_060_075n, 0.0025, 238) + 3_600n);
    expect(paidLines(lines)).toHaveLength(238);
  });

  it("releases the capital in steps with drawdowns", () => {
    const events = [
      event("2025-12-01", "drawdown", 4_000_000n),
      event("2026-03-20", "drawdown", 8_000_000n),
    ];
    const terms = loan({ deferralMode: "interest", deferralMonths: 6 });
    const lines = loanSchedule(terms, events);
    const payments = lines.filter((line) => line.kind === "payment");
    expect(payments[0]!.interest).toBe(10_000n);
    expect(payments[2]!.interest).toBe(10_000n);
    expect(payments[3]!.interest).toBe(30_000n);
    expect(payments[6]!.total).toBe(annuity(12_000_000n, 0.0025, 234));
    expect(lines.at(-1)!.remaining).toBe(0n);
    expect(remainingCapital(terms, events, "2025-11-30")).toBe(0n);
    expect(remainingCapital(terms, events, "2026-01-01")).toBe(4_000_000n);
    expect(remainingCapital(terms, events, "2026-03-20")).toBe(12_000_000n);
  });

  it("shortens the loan after a partial repayment keeping the payment", () => {
    const lines = loanSchedule(loan(), [event("2026-03-05", "repayment", 5_000_000n)]);
    const repayment = lines.findIndex((line) => line.kind === "repayment");
    // After the payment of its day.
    expect(lines[repayment - 1]!.date).toBe("2026-03-05");
    expect(lines[repayment]).toMatchObject({ capital: 5_000_000n, total: 5_000_000n });
    expect(lines[repayment + 1]!.total).toBe(66_552n);
    expect(lines.filter((line) => line.kind === "payment").length).toBeLessThan(240);
    expect(lines.at(-1)!.remaining).toBe(0n);
  });

  it("lowers the payment after a partial repayment keeping the term", () => {
    const lines = loanSchedule(loan(), [event("2026-03-10", "repayment", 5_000_000n, "term")]);
    expect(lines.filter((line) => line.kind === "payment")).toHaveLength(240);
    expect(lines[4]!.total).toBeLessThan(40_000n);
    expect(lines.at(-1)!.remaining).toBe(0n);
  });

  it("ends with a full repayment or a buy-back", () => {
    for (const kind of ["repayment", "buyback"] as const) {
      const events = [event("2026-02-10", kind)];
      const lines = loanSchedule(loan(), events);
      expect(lines.map((line) => line.kind)).toEqual(["payment", "payment", kind]);
      expect(lines[2]!.remaining).toBe(0n);
      expect(remainingCapital(loan(), events, "2026-02-09")).toBe(lines[1]!.remaining);
      expect(remainingCapital(loan(), events, "2030-01-01")).toBe(0n);
      // The new lender pays a buy-back.
      expect(paidLines(lines)).toHaveLength(kind === "repayment" ? 3 : 2);
    }
  });

  it("repays no more than what is left", () => {
    const lines = loanSchedule(loan(), [event("2026-01-10", "repayment", 99_000_000n)]);
    expect(lines.at(-1)).toMatchObject({ capital: 11_963_448n, remaining: 0n });
  });
});

describe("effective rate", () => {
  it("is the rate of the schedule, and higher with the insurance", () => {
    const plain = effectiveRates(loan(), []);
    // A twelfth a month is 3.04 % over the year.
    expect(plain.withoutInsurance).toBeGreaterThan(3.02);
    expect(plain.withoutInsurance).toBeLessThan(3.06);
    expect(plain.withInsurance).toBeCloseTo(plain.withoutInsurance!, 6);

    const insured = effectiveRates(loan({ insuranceMode: "initial", insuranceRate: "0.36" }), []);
    expect(insured.withoutInsurance).toBeCloseTo(plain.withoutInsurance!, 6);
    expect(insured.withInsurance!).toBeGreaterThan(insured.withoutInsurance! + 0.4);
    // An insurance paid apart counts the same.
    const apart = effectiveRates(
      loan({ insuranceMode: "initial", insuranceRate: "0.36", insuranceSeparate: true }),
      [],
    );
    expect(apart.withInsurance).toBeCloseTo(insured.withInsurance!, 6);
  });

  it("does not change with the events that come after", () => {
    const base = effectiveRates(loan(), []);
    const later = effectiveRates(loan(), [event("2030-01-10", "repayment", 5_000_000n)]);
    expect(later.withoutInsurance).toBe(base.withoutInsurance);
  });
});

describe("loan and journal", () => {
  it("pairs a payment with the closest entry, one each", () => {
    const lines = [{ date: "2026-01-31" }, { date: "2026-02-28" }, { date: "2026-03-31" }];
    const entries = [{ date: "2026-03-02" }, { date: "2026-02-02" }];
    expect(matchPayments(lines, entries)).toEqual([1, 0, undefined]);
  });

  const lines = loanSchedule(loan(), []);
  const entry = (index: number, amount = -lines[index]!.capital) => ({
    date: lines[index]!.date,
    amount,
  });

  it("agrees with a journal that holds the capital of each month", () => {
    const check = checkCapital(lines, [entry(2), entry(3)], "2026-04-30")!;
    expect(check).toMatchObject({ from: "2026-03", to: "2026-04" });
    expect(check.journal).toBe(check.schedule);
  });

  it("sees a missing payment, but not one of a month not reconciled yet", () => {
    const missing = checkCapital(lines, [entry(0), entry(2)], "2026-03-30")!;
    expect(missing.schedule - missing.journal).toBe(lines[1]!.capital);
    const ahead = checkCapital(lines, [entry(0), entry(1)], "2026-03-02")!;
    expect(ahead).toMatchObject({ to: "2026-02" });
    expect(ahead.journal).toBe(ahead.schedule);
  });

  it("compares nothing without an entry", () => {
    expect(checkCapital(lines, [], "2026-04-30")).toBeUndefined();
  });
});

describe("loan input", () => {
  const id = "00000000-0000-4000-8000-000000000000";
  const input = {
    name: "House",
    amount: "120000",
    rate: "3.15",
    term: 240,
    start: "2026-01-05",
    accountId: id,
    capitalSubCategoryId: id,
    interestSubCategoryId: id,
  };

  it("asks for the sub-category of an insurance and the months of a deferral", () => {
    expect(loanInputSchema.safeParse(input).success).toBe(true);
    for (const wrong of [
      { insuranceMode: "initial" },
      { deferralMode: "interest" },
      { deferralMonths: 3 },
      { deferralMode: "total", deferralMonths: 240 },
    ]) {
      expect(loanInputSchema.safeParse({ ...input, ...wrong }).success).toBe(false);
    }
  });

  it("asks for the amount of a drawdown only", () => {
    const ok = (value: unknown) => loanEventInputSchema.safeParse(value).success;
    expect(ok({ date: "2026-01-05", kind: "drawdown" })).toBe(false);
    expect(ok({ date: "2026-01-05", kind: "repayment" })).toBe(true);
    expect(ok({ date: "2026-01-05", kind: "buyback", amount: "10" })).toBe(false);
    expect(ok({ date: "2026-01-05", kind: "buyback", penalty: "1500" })).toBe(true);
    expect(ok({ date: "2026-01-05", kind: "drawdown", amount: "5", penalty: "1" })).toBe(false);
    expect(ok({ date: "2026-01-05", kind: "insurance" })).toBe(false);
    expect(ok({ date: "2026-01-05", kind: "insurance", insuranceMode: "initial" })).toBe(true);
    expect(ok({ date: "2026-01-05", kind: "repayment", insuranceMode: "initial" })).toBe(false);
  });
});

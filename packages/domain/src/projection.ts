/** The balance of an account at the end of a day, in minor units of its currency. */
export interface BalancePoint {
  date: string;
  balance: bigint;
}

/**
 * The balance of an account over a window as a step series: the opening
 * balance on `from`, then the balance after each day that changes it. A day's
 * changes arrive already added up; a change dated before `from` or after `to`
 * is left out, since the opening balance already holds the first and the
 * window does not reach the second.
 */
export function balanceSeries(
  opening: bigint,
  changes: readonly { date: string; amount: bigint }[],
  from: string,
  to: string,
): BalancePoint[] {
  const points: BalancePoint[] = [{ date: from, balance: opening }];
  let balance = opening;
  const sorted = [...changes].sort((a, b) => a.date.localeCompare(b.date));
  for (const { date, amount } of sorted) {
    if (date < from || date > to) continue;
    balance += amount;
    const last = points[points.length - 1]!;
    if (last.date === date) last.balance = balance;
    else points.push({ date, balance });
  }
  return points;
}

/** A stretch where an account is overdrawn. */
export interface Overdraft {
  /** The first day the balance is below zero. */
  from: string;
  /** The day it is back to zero or more; null when it stays below to the window's end. */
  until: string | null;
  /** The lowest balance of the stretch, and its first day. */
  lowest: bigint;
  lowestDate: string;
}

/** The stretches of a series where the balance is below zero. */
export function overdrafts(series: readonly BalancePoint[]): Overdraft[] {
  const found: Overdraft[] = [];
  let current: Overdraft | null = null;
  for (const { date, balance } of series) {
    if (balance < 0n) {
      if (!current) {
        current = { from: date, until: null, lowest: balance, lowestDate: date };
        found.push(current);
      } else if (balance < current.lowest) {
        current.lowest = balance;
        current.lowestDate = date;
      }
    } else if (current) {
      current.until = date;
      current = null;
    }
  }
  return found;
}

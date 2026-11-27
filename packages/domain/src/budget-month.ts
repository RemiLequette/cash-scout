/**
 * The budget month of an entry. It is the month of its date, unless the entry is
 * shifted: then the month before for a date up to the 15th, and the month after
 * for a later one. Balances always follow the date.
 */

/** The last day of a month from which a shifted entry counts in the month before. */
export const SHIFT_BACK_UNTIL_DAY = 15;

/** The month an entry counts in for the budget, as "2026-11". */
export function budgetMonth(date: string, shifted: boolean): string {
  if (!shifted) return date.slice(0, 7);
  const step = Number(date.slice(8, 10)) <= SHIFT_BACK_UNTIL_DAY ? -1 : 1;
  const index = Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1 + step;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** The month an entry dated `date` counts in, when it is meant to stay in `kept`, if any. */
export function monthKept(date: string, kept: string | null): string {
  return budgetMonth(date, kept !== null && shiftToKeep(date, kept));
}

/**
 * Whether an entry dated `date` must be shifted to count in `month`. False when
 * the date is already in it, or when a shift cannot reach it.
 */
export function shiftToKeep(date: string, month: string): boolean {
  return date.slice(0, 7) !== month && budgetMonth(date, true) === month;
}

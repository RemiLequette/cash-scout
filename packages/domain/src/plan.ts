/**
 * Planning a category's year: what is saved in one go, and how the planned
 * entries of a year are proposed from the previous one or from a schedule.
 */
import { z } from "zod";
import { versionSchema } from "./book.js";
import { budgetBatchSchema } from "./budget.js";
import {
  entryInputSchema,
  entryUpdateSchema,
  transferInputSchema,
  transferUpdateSchema,
} from "./journal.js";

const MOST = 2000;

/**
 * The grid and the planned entries of a category, saved together, all or
 * nothing: entries to create (they are planned), to change and to delete.
 */
export const planSchema = z.object({
  budget: budgetBatchSchema,
  create: z.array(entryInputSchema).max(MOST).default([]),
  update: z
    .array(entryUpdateSchema.and(z.object({ id: z.uuid() })))
    .max(MOST)
    .default([]),
  remove: z
    .array(z.object({ id: z.uuid(), version: versionSchema }))
    .max(MOST)
    .default([]),
});
export type PlanInput = z.input<typeof planSchema>;

/**
 * The planned transfers of a year, saved together, all or nothing: transfers to
 * create (they are planned), to change and to delete.
 */
export const transferPlanSchema = z.object({
  create: z.array(transferInputSchema).max(MOST).default([]),
  update: z
    .array(transferUpdateSchema.and(z.object({ id: z.uuid(), version: versionSchema })))
    .max(MOST)
    .default([]),
  remove: z
    .array(z.object({ id: z.uuid(), version: versionSchema }))
    .max(MOST)
    .default([]),
});
export type TransferPlanInput = z.input<typeof transferPlanSchema>;

/** The same day one year later; 29 February becomes 28 February. */
export function yearAhead(date: string): string {
  const [year, month, day] = date.split("-");
  return `${Number(year) + 1}-${month}-${month === "02" && day === "29" ? "28" : day}`;
}

/**
 * The dates of a schedule: every `months` months from `first` up to `last`, on
 * the day of `first`, or the month's last day when the month is shorter.
 */
export function scheduleDates(first: string, last: string, months: number): string[] {
  const [year, month, day] = first.split("-").map(Number);
  const dates: string[] = [];
  if (!year || !month || !day || !(months >= 1)) return dates;
  for (let step = 0; dates.length < MOST; step += months) {
    const at = new Date(Date.UTC(year, month - 1 + step, 1));
    const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0)).getUTCDate();
    at.setUTCDate(Math.min(day, end));
    const date = at.toISOString().slice(0, 10);
    if (date > last) break;
    dates.push(date);
  }
  return dates;
}

/** What tells an entry is already there when a year is copied again. */
interface Copyable {
  date: string;
  subCategoryId: string;
  description: string;
}

/**
 * The entries of the previous year still to copy: each a year later, unless the
 * year already holds one of the same date, sub-category and description. Two
 * alike last year need two alike this year to be both left out.
 */
export function entriesToCopy<T extends Copyable>(
  previous: readonly T[],
  existing: readonly Copyable[],
): T[] {
  const key = (e: Copyable, date: string) =>
    JSON.stringify([date, e.subCategoryId, e.description.trim()]);
  const there = new Map<string, number>();
  for (const entry of existing) {
    const k = key(entry, entry.date);
    there.set(k, (there.get(k) ?? 0) + 1);
  }
  return previous.flatMap((entry) => {
    const date = yearAhead(entry.date);
    const k = key(entry, date);
    const left = there.get(k) ?? 0;
    if (left > 0) {
      there.set(k, left - 1);
      return [];
    }
    return [{ ...entry, date }];
  });
}

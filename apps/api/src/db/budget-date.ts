import { SHIFT_BACK_UNTIL_DAY } from "@cash-scout/domain";
import { sql } from "drizzle-orm";
import { journalEntry } from "./schema.js";

/**
 * A date inside the budget month of an entry: its own date, or when shifted the
 * same day one month before or after. The SQL side of `budgetMonth`.
 */
export const BUDGET_DATE = sql`(case
  when not ${journalEntry.monthShifted} then ${journalEntry.date}
  when extract(day from ${journalEntry.date}) <= ${sql.raw(String(SHIFT_BACK_UNTIL_DAY))}
    then (${journalEntry.date} - interval '1 month')::date
  else (${journalEntry.date} + interval '1 month')::date
end)`;

export const BUDGET_MONTH = sql<number>`extract(month from ${BUDGET_DATE})::int`;

export const BUDGET_YEAR = sql<number>`extract(year from ${BUDGET_DATE})::int`;

export const inBudgetYear = (year: number) => sql`extract(year from ${BUDGET_DATE}) = ${year}`;

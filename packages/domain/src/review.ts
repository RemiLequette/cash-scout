import { z } from "zod";
import { daysBetween, rateSchema } from "./journal.js";

/**
 * Reviewing an import batch (see docs/bank-import.md): what is decided for each
 * line, and which journal entry a line may already be.
 */

/** A bank date and the date of an entry already reconciled may differ by a few days. */
export const matchWindowDays = 5;
/** A forecast is further from the truth: its date may be further off, and its amount too. */
export const forecastWindowDays = 10;
export const forecastTolerancePercent = 10;

export interface MatchLine {
  id: string;
  date: string;
  /** Signed, in minor units of the account currency. */
  amount: bigint;
}

export interface MatchEntry extends MatchLine {
  /** An entry that is not reconciled is a forecast. */
  reconciled: boolean;
  /** One side of a transfer: its amount is tied to the other side. */
  transfer?: boolean;
}

/**
 * May a line be this entry although the amounts differ? Only a forecast that is
 * not a side of a transfer takes the bank's amount.
 */
export function takesAmount(entry: { reconciled: boolean; transfer?: boolean }): boolean {
  return !entry.reconciled && !entry.transfer;
}

/** Same amount, or for a forecast one within the tolerance (and of the same sign). */
function amountFits(line: bigint, entry: MatchEntry): boolean {
  if (line === entry.amount) return true;
  if (!takesAmount(entry) || line < 0n !== entry.amount < 0n) return false;
  const abs = (value: bigint) => (value < 0n ? -value : value);
  return abs(line - entry.amount) * 100n <= abs(entry.amount) * BigInt(forecastTolerancePercent);
}

/**
 * The journal entries each line may already be. A forecast fits within
 * `forecastWindowDays` and, unless a side of a transfer, within
 * `forecastTolerancePercent` of its amount; a reconciled entry needs the same
 * amount within `matchWindowDays`. The best first: the exact amount, then the
 * closest date, then a forecast. An entry is proposed to one line only, so two
 * identical purchases do not both claim the single entry of the journal.
 * `lines` and `entries` belong to the same account.
 */
export function matchLines(
  lines: readonly MatchLine[],
  entries: readonly MatchEntry[],
): Map<string, string[]> {
  const pairs = lines.flatMap((line) =>
    entries
      .filter((entry) => amountFits(line.amount, entry))
      .map((entry) => ({
        line,
        entry,
        exact: entry.amount === line.amount,
        gap: Math.abs(daysBetween(line.date, entry.date)),
      }))
      .filter((pair) => pair.gap <= (pair.entry.reconciled ? matchWindowDays : forecastWindowDays)),
  );
  pairs.sort(
    (a, b) =>
      Number(b.exact) - Number(a.exact) ||
      a.gap - b.gap ||
      Number(a.entry.reconciled) - Number(b.entry.reconciled) ||
      a.line.date.localeCompare(b.line.date) ||
      a.entry.date.localeCompare(b.entry.date),
  );
  const proposed = new Map<string, string>();
  const taken = new Set<string>();
  for (const { line, entry } of pairs) {
    if (proposed.has(line.id) || taken.has(entry.id)) continue;
    proposed.set(line.id, entry.id);
    taken.add(entry.id);
  }
  const result = new Map<string, string[]>();
  for (const line of lines) {
    const first = proposed.get(line.id);
    if (first === undefined) continue;
    // After the proposal, the other entries no line was given.
    const others = pairs
      .filter((pair) => pair.line.id === line.id && !taken.has(pair.entry.id))
      .map((pair) => pair.entry.id);
    result.set(line.id, [first, ...others]);
  }
  return result;
}

export type LineStatus = "review" | "validated" | "ignored" | "imported";

/** What is decided for a line: a new entry in a sub-category, or an existing entry. */
export interface LineDecision {
  status: LineStatus;
  subCategoryId: string | null;
  entryId: string | null;
}

export const lineChangeSchema = z
  .object({
    id: z.uuid(),
    status: z.enum(["review", "validated", "ignored"]).optional(),
    /** The line becomes a new entry of this sub-category. */
    subCategoryId: z.uuid().nullable().optional(),
    /** The line is this entry of the journal: it gets reconciled. */
    entryId: z.uuid().nullable().optional(),
    description: z.string().trim().max(500).nullable().optional(),
  })
  .refine((c) => !(c.subCategoryId && c.entryId), {
    message: "A line is a new entry or an existing one, not both",
  });
export type LineChange = z.infer<typeof lineChangeSchema>;

export const reviewChangesSchema = z.object({
  changes: z.array(lineChangeSchema).min(1).max(2000),
});
export type ReviewChanges = z.input<typeof reviewChangesSchema>;

export const importRequestSchema = z.object({
  /** Also set the account's opening balance from the statement's last balance. */
  setOpening: z.boolean().default(false),
  /** For an account not in the book currency: the rate of everything imported. */
  exchangeRate: rateSchema.optional(),
});
export type ImportRequest = z.input<typeof importRequestSchema>;

/**
 * A line's decision after a change. Choosing a sub-category or an entry
 * validates the line, removing the choice sends it back to review; ignoring
 * keeps the choice. Throws a `RangeError` for an imported line, and when a line
 * is validated with nothing chosen.
 */
export function decide(current: LineDecision, change: Omit<LineChange, "id">): LineDecision {
  if (current.status === "imported") {
    throw new RangeError("An imported line cannot change");
  }
  const next: LineDecision = {
    status: current.status,
    subCategoryId: current.subCategoryId,
    entryId: current.entryId,
  };
  if (change.subCategoryId !== undefined) {
    next.subCategoryId = change.subCategoryId;
    if (change.subCategoryId) next.entryId = null;
    next.status = change.subCategoryId ? "validated" : "review";
  }
  if (change.entryId !== undefined) {
    next.entryId = change.entryId;
    if (change.entryId) next.subCategoryId = null;
    next.status = change.entryId || next.subCategoryId ? "validated" : "review";
  }
  if (change.status !== undefined) next.status = change.status;
  if (next.status === "validated" && !next.subCategoryId && !next.entryId) {
    throw new RangeError("Choose a sub-category or an entry to validate a line");
  }
  return next;
}

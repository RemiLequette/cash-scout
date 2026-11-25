import { z } from "zod";
import { money, parseAmount, toDecimalString } from "./money.js";

/**
 * Reading a bank statement: a table of cells (from a CSV or a spreadsheet) and
 * a column mapping give statement lines. Pure: the file is read elsewhere.
 */

/** A column, by its header text (case ignored) or by its position (0 is the first). */
const columnRef = z.union([z.string().min(1), z.number().int().min(0)]);
/** One column, or several whose texts are joined with a space. */
const field = z.union([columnRef, z.array(columnRef).min(1)]);

export const dateFormats = ["iso", "dmy", "yyyymmdd"] as const;

/**
 * Where the fields of a statement line are in the table. The amount is either
 * one signed column, or a debit and a credit column (a debit is money out
 * whatever its sign).
 */
export const columnMappingSchema = z
  .object({
    /** Index of the header line, from 0; the lines before it are ignored. */
    headerRow: z.number().int().min(0).default(0),
    date: columnRef,
    valueDate: columnRef.optional(),
    amount: columnRef.optional(),
    debit: columnRef.optional(),
    credit: columnRef.optional(),
    label: field,
    /** The bank's cleaned counterparty, when it gives one. */
    counterparty: field.optional(),
    memo: field.optional(),
    reference: columnRef.optional(),
    bankCategory: field.optional(),
    /** The balance after the line, when the bank gives one. */
    balance: columnRef.optional(),
    accountNumber: columnRef.optional(),
    /** `iso` 2026-10-30, `dmy` 30/10/2026, `yyyymmdd` 20261030. */
    dateFormat: z.enum(dateFormats),
    /** The decimal separator of the amounts. */
    decimal: z.enum([",", "."]),
    /** The decimal separator of the balance, when it differs from the amounts'. */
    balanceDecimal: z.enum([",", "."]).optional(),
  })
  .refine((m) => (m.amount !== undefined) !== (m.debit !== undefined || m.credit !== undefined), {
    message: "Give either an amount column, or a debit and/or a credit column",
  });
export type ColumnMapping = z.infer<typeof columnMappingSchema>;
export type ColumnMappingInput = z.input<typeof columnMappingSchema>;

/** One line of a statement, as read; nothing in it is matched with the book yet. */
export interface StatementLine {
  /** The line's number in the file, from 1, for messages and traceability. */
  row: number;
  /** The operation date, `2026-10-30`. */
  date: string;
  valueDate: string | null;
  /** Signed, in minor units of the statement's currency. */
  amount: bigint;
  label: string;
  counterparty: string;
  memo: string;
  reference: string;
  bankCategory: string;
  /** The balance after the line, in minor units, when the statement gives it. */
  balance: bigint | null;
  accountNumber: string;
  /** The cells of the source line. */
  raw: string[];
}

export interface StatementError {
  row: number;
  message: string;
}

export interface ParsedStatement {
  lines: StatementLine[];
  errors: StatementError[];
}

const SPACES = new RegExp(`[\\s${String.fromCharCode(0xa0, 0x202f)}]`, "g");

/** "+1 234,56" or "541.8" as an exact decimal text "1234.56", or undefined. */
function decimalText(raw: string, decimal: "," | "."): string | undefined {
  const compact = raw.replace(SPACES, "").replace(/^\+/, "");
  const text =
    decimal === "," ? compact.replace(/\./g, "").replace(",", ".") : compact.replace(/,/g, "");
  return /^-?\d+(\.\d+)?$/.test(text) ? text : undefined;
}

/** A date in the given format as `2026-10-30`, or undefined when it is not a real date. */
export function statementDate(
  raw: string,
  format: (typeof dateFormats)[number],
): string | undefined {
  const text = raw.trim().replace(/\.0+$/, "");
  const match =
    format === "iso"
      ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
      : format === "dmy"
        ? /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text)
        : /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (!match) return undefined;
  const [year, month, day] =
    format === "dmy"
      ? [match[3]!, match[2]!.padStart(2, "0"), match[1]!.padStart(2, "0")]
      : [match[1]!, match[2]!, match[3]!];
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(iso) ? iso : undefined;
}

/**
 * Turns a table into statement lines. Blank lines are skipped; a line that
 * cannot be read is reported in `errors` and left out, the others are kept.
 * A mapping that names a column the table does not have throws a `RangeError`:
 * the file is not the one the mapping describes.
 */
export function readStatement(
  table: readonly (readonly string[])[],
  mapping: ColumnMapping,
  currency: string,
): ParsedStatement {
  const header = table[mapping.headerRow];
  if (!header) throw new RangeError("The file has no header line");
  const names = header.map((cell) => cell.trim().toLocaleLowerCase());
  const indexOf = (ref: string | number): number => {
    const index = typeof ref === "number" ? ref : names.indexOf(ref.trim().toLocaleLowerCase());
    if (index < 0 || index >= header.length) {
      throw new RangeError(`Column "${ref}" is not in the file`);
    }
    return index;
  };
  const one = (ref: string | number | undefined) => (ref === undefined ? undefined : indexOf(ref));
  const many = (ref: z.infer<typeof field> | undefined) =>
    ref === undefined ? [] : (Array.isArray(ref) ? ref : [ref]).map(indexOf);

  const col = {
    date: indexOf(mapping.date),
    valueDate: one(mapping.valueDate),
    amount: one(mapping.amount),
    debit: one(mapping.debit),
    credit: one(mapping.credit),
    label: many(mapping.label),
    counterparty: many(mapping.counterparty),
    memo: many(mapping.memo),
    reference: one(mapping.reference),
    bankCategory: many(mapping.bankCategory),
    balance: one(mapping.balance),
    accountNumber: one(mapping.accountNumber),
  };

  const lines: StatementLine[] = [];
  const errors: StatementError[] = [];
  for (let i = mapping.headerRow + 1; i < table.length; i++) {
    const cells = table[i]!;
    const row = i + 1;
    if (cells.every((cell) => cell.trim() === "")) continue;
    const cell = (index: number | undefined) =>
      index === undefined ? "" : (cells[index] ?? "").trim();
    const text = (indexes: number[]) =>
      indexes
        .map((index) => cell(index))
        .filter((value) => value !== "")
        .join(" ");
    const fail = (message: string) => errors.push({ row, message });

    const date = statementDate(cell(col.date), mapping.dateFormat);
    if (!date) {
      fail(`Unreadable date "${cell(col.date)}"`);
      continue;
    }
    let valueDate: string | null = null;
    if (col.valueDate !== undefined && cell(col.valueDate) !== "") {
      valueDate = statementDate(cell(col.valueDate), mapping.dateFormat) ?? null;
    }

    let amount: bigint;
    try {
      amount = lineAmount(cell, col, mapping, currency);
    } catch (error) {
      fail((error as Error).message);
      continue;
    }

    let balance: bigint | null = null;
    if (col.balance !== undefined && cell(col.balance) !== "") {
      const balanceText = decimalText(cell(col.balance), mapping.balanceDecimal ?? mapping.decimal);
      try {
        balance = balanceText === undefined ? null : parseAmount(balanceText, currency).minor;
      } catch {
        balance = null;
      }
    }

    lines.push({
      row,
      date,
      valueDate,
      amount,
      label: text(col.label),
      counterparty: text(col.counterparty),
      memo: text(col.memo),
      reference: cell(col.reference),
      bankCategory: text(col.bankCategory),
      balance,
      accountNumber: cell(col.accountNumber),
      raw: [...cells],
    });
  }
  return { lines, errors };
}

function lineAmount(
  cell: (index: number | undefined) => string,
  col: { amount?: number | undefined; debit?: number | undefined; credit?: number | undefined },
  mapping: ColumnMapping,
  currency: string,
): bigint {
  const minor = (raw: string): bigint => {
    const text = decimalText(raw, mapping.decimal);
    if (text === undefined) throw new RangeError(`Unreadable amount "${raw}"`);
    return parseAmount(text, currency).minor;
  };
  const abs = (value: bigint) => (value < 0n ? -value : value);
  if (col.amount !== undefined) {
    const raw = cell(col.amount);
    if (raw === "") throw new RangeError("No amount");
    return minor(raw);
  }
  const debit = cell(col.debit);
  const credit = cell(col.credit);
  if (debit === "" && credit === "") throw new RangeError("No amount");
  return (credit === "" ? 0n : abs(minor(credit))) - (debit === "" ? 0n : abs(minor(debit)));
}

/** A line of {@link StatementPreview}: amounts as exact decimal text. */
export interface PreviewLine {
  row: number;
  date: string;
  valueDate: string | null;
  amount: string;
  label: string;
  counterparty: string;
  memo: string;
  reference: string;
  bankCategory: string;
  balance: string | null;
}

/** A day whose balance does not follow from the previous day's and its lines. */
export interface BalanceBreak {
  date: string;
  /** The previous day's balance plus the day's lines. */
  expected: string;
  found: string;
}

/** What a user sees of a statement before anything is imported. */
export interface StatementPreview {
  currency: string;
  lines: PreviewLine[];
  errors: StatementError[];
  /** The sum of the lines. */
  total: string;
  balanceBreaks: BalanceBreak[];
  /** The account numbers the file mentions, to check it is the right account's. */
  accountNumbers: string[];
}

/**
 * Checks the balances of a statement day by day: a day's balance is the balance
 * of the previous day with a balance, plus the day's lines. Banks that give a
 * balance at the end of each day (Boursorama) follow this; a day whose lines
 * show several balances takes the most frequent. Days without a balance are skipped.
 */
export function balanceBreaks(lines: readonly StatementLine[], currency: string): BalanceBreak[] {
  const days = new Map<string, { sum: bigint; seen: Map<bigint, number> }>();
  for (const line of lines) {
    const day = days.get(line.date) ?? { sum: 0n, seen: new Map<bigint, number>() };
    day.sum += line.amount;
    if (line.balance !== null) day.seen.set(line.balance, (day.seen.get(line.balance) ?? 0) + 1);
    days.set(line.date, day);
  }
  const breaks: BalanceBreak[] = [];
  let previous: bigint | undefined;
  for (const date of [...days.keys()].sort()) {
    const day = days.get(date)!;
    const found = [...day.seen].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (found === undefined) continue;
    if (previous !== undefined && previous + day.sum !== found) {
      breaks.push({
        date,
        expected: toDecimalString(money(previous + day.sum, currency)),
        found: toDecimalString(money(found, currency)),
      });
    }
    previous = found;
  }
  return breaks;
}

/** The statement as the interface shows it: text amounts, the sum, the balance check. */
export function previewOf(parsed: ParsedStatement, currency: string): StatementPreview {
  const text = (minor: bigint) => toDecimalString(money(minor, currency));
  return {
    currency,
    lines: parsed.lines.map((line) => ({
      row: line.row,
      date: line.date,
      valueDate: line.valueDate,
      amount: text(line.amount),
      label: line.label,
      counterparty: line.counterparty,
      memo: line.memo,
      reference: line.reference,
      bankCategory: line.bankCategory,
      balance: line.balance === null ? null : text(line.balance),
    })),
    errors: parsed.errors,
    total: text(parsed.lines.reduce((sum, line) => sum + line.amount, 0n)),
    balanceBreaks: balanceBreaks(parsed.lines, currency),
    accountNumbers: [...new Set(parsed.lines.map((l) => l.accountNumber).filter((n) => n !== ""))],
  };
}

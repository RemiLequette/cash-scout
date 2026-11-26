/**
 * Import of journal entries from a CSV file (see docs/import.md).
 *
 * Columns: date, account, sub_category, category_code, description,
 * payment_type, amount, planned_amount, exchange_rate, book_amount,
 * original_amount, original_currency, reconciled.
 *
 * Accounts, sub-categories and payment types are matched by their name in the
 * book's default language, ignoring case. Archived items are matched too, so
 * old entries can be imported. Every line is a new entry: an import run twice
 * creates the entries twice.
 */
import {
  bookAmount,
  currencySchema,
  parseAmount,
  rateBetween,
  rateSchema,
  type Money,
  type Names,
} from "@cash-scout/domain";
import { eq } from "drizzle-orm";
import type { Tx } from "../db/client.js";
import {
  book,
  bookAccount,
  category,
  journalEntry,
  paymentType,
  subCategory,
} from "../db/schema.js";
import { languagesOf } from "../routes/access.js";
import { ImportError, parseCsv } from "./reference.js";

export interface JournalImportSummary {
  created: number;
}

type Row = Record<string, string>;

/** Spaces used as thousands separators, including no-break spaces. */
const SPACES = new RegExp(`[\\s${String.fromCharCode(0xa0, 0x202f)}]`, "g");

/** Normalises "1 234,56" or "1,234.56" to "1234.56". */
export function decimalText(text: string): string {
  const compact = text.replace(SPACES, "");
  return compact.includes(".") ? compact.replace(/,/g, "") : compact.replace(",", ".");
}

/** Reads "2026-11-22" or "22/11/2026" as "2026-11-22". */
export function isoDate(text: string): string | undefined {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const french = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  const [year, month, day] = iso
    ? [iso[1], iso[2], iso[3]]
    : french
      ? [french[3], french[2]!.padStart(2, "0"), french[1]!.padStart(2, "0")]
      : [];
  if (!year || !month || !day) return undefined;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(`${year}-${month}-${day}`)
    ? `${year}-${month}-${day}`
    : undefined;
}

const yes = new Set(["yes", "y", "true", "1", "x", "oui", "o", "vrai"]);
const no = new Set(["", "no", "n", "false", "0", "non", "faux"]);

/** Imports journal entries into a book, inside the caller's transaction. */
export async function importJournal(
  tx: Tx,
  bookId: string,
  csv: string,
): Promise<JournalImportSummary> {
  const { defaultLanguage } = await languagesOf(tx, bookId);
  const [bookRow] = await tx
    .select({ currency: book.currency })
    .from(book)
    .where(eq(book.id, bookId));
  if (!bookRow) throw new ImportError("Book not found");
  const bookCurrency = bookRow.currency;
  const key = (names: Names) => (names[defaultLanguage] ?? "").trim().toLocaleLowerCase();

  /** Items by name; a name used twice is ambiguous and stored as null. */
  function byName<T extends { names: Names }>(items: T[]) {
    const map = new Map<string, T | null>();
    for (const item of items) {
      const k = key(item.names);
      map.set(k, map.has(k) ? null : item);
    }
    return map;
  }

  const accounts = byName(
    await tx.select().from(bookAccount).where(eq(bookAccount.bookId, bookId)),
  );
  const paymentTypes = byName(
    await tx.select().from(paymentType).where(eq(paymentType.bookId, bookId)),
  );
  const subCategories = await tx
    .select({ id: subCategory.id, names: subCategory.names, code: category.code })
    .from(subCategory)
    .innerJoin(category, eq(category.id, subCategory.categoryId))
    .where(eq(subCategory.bookId, bookId));
  const subByName = byName(subCategories);
  const subByCode = new Map(subCategories.map((s) => [`${s.code}|${key(s.names)}`, s]));

  const rows = parseCsv(csv);
  const values = rows.map((row: Row, index) => {
    const line = index + 2;
    const fail = (message: string): never => {
      throw new ImportError(`Line ${line}: ${message}`);
    };
    const required = (column: string) =>
      row[column] || fail(`column "${column}" is empty or missing`);
    const amountOf = (column: string, currency: string): Money => {
      try {
        return parseAmount(decimalText(required(column)), currency);
      } catch (error) {
        return fail(`${column}: ${(error as Error).message}`);
      }
    };
    const find = <T>(map: Map<string, T | null>, column: string, what: string): T => {
      const name = required(column);
      const found = map.get(name.toLocaleLowerCase());
      if (found === null) return fail(`"${name}" names more than one ${what}`);
      return found ?? fail(`no ${what} named "${name}" in the book's default language`);
    };

    const date = isoDate(required("date")) ?? fail(`invalid date "${row.date}"`);
    const account = find(accounts, "account", "account");

    const subName = required("sub_category");
    const sub = row.category_code
      ? (subByCode.get(`${row.category_code}|${subName.toLocaleLowerCase()}`) ??
        fail(`no sub-category "${subName}" in the category ${row.category_code}`))
      : find(subByName, "sub_category", "sub-category");

    const payment = row.payment_type ? find(paymentTypes, "payment_type", "payment type") : null;

    const amount = amountOf("amount", account.currency);
    // No planned amount: the entry was not planned, and consumes its category's budget.
    const planned = row.planned_amount
      ? amountOf("planned_amount", account.currency)
      : { minor: 0n };

    let rate = "1";
    let inBook = amount;
    if (account.currency !== bookCurrency) {
      if (row.exchange_rate) {
        rate = decimalText(row.exchange_rate);
        if (!rateSchema.safeParse(rate).success) fail(`invalid exchange rate "${rate}"`);
        inBook = bookAmount(amount, rate, bookCurrency);
      } else if (row.book_amount) {
        inBook = amountOf("book_amount", bookCurrency);
        try {
          rate = rateBetween(amount, inBook);
        } catch (error) {
          fail((error as Error).message);
        }
      } else {
        fail(
          `the account is in ${account.currency}: give exchange_rate or book_amount in ${bookCurrency}`,
        );
      }
    }

    let original: { originalAmount: bigint | null; originalCurrency: string | null } = {
      originalAmount: null,
      originalCurrency: null,
    };
    if (row.original_amount || row.original_currency) {
      const currency = currencySchema.safeParse(required("original_currency").toUpperCase());
      if (!currency.success) fail(`unknown currency "${row.original_currency}"`);
      original = {
        originalAmount: amountOf("original_amount", currency.data!).minor,
        originalCurrency: currency.data!,
      };
    }

    const reconciledText = (row.reconciled ?? "").toLowerCase();
    if (!yes.has(reconciledText) && !no.has(reconciledText)) {
      fail(`reconciled: "${row.reconciled}" is not yes or no`);
    }

    return {
      bookId,
      date,
      accountId: account.id,
      subCategoryId: sub.id,
      description: (row.description ?? "").slice(0, 500),
      paymentTypeId: payment?.id ?? null,
      amount: amount.minor,
      plannedAmount: planned.minor,
      exchangeRate: rate,
      bookAmount: inBook.minor,
      ...original,
      reconciled: yes.has(reconciledText),
    };
  });

  // Insert in batches to keep each statement small.
  for (let i = 0; i < values.length; i += 500) {
    await tx.insert(journalEntry).values(values.slice(i, i + 500));
  }
  return { created: values.length };
}

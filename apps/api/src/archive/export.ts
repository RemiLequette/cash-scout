import { asc, eq } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Tx } from "../db/client.js";
import { book, bookLanguage } from "../db/schema.js";
import { ARCHIVED, archivedColumns, tableName } from "./tables.js";

export const ARCHIVE_FORMAT = "cash-scout-book";
/** Raised when a file of the previous version can no longer be read as it is. */
export const ARCHIVE_VERSION = 1;

/** Amounts are written as text, so that no precision is lost. */
function written(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(written);
  return value;
}

/** The whole of a book, as the file its owner downloads. */
export async function exportBook(tx: Tx, bookId: string) {
  const [header] = await tx.select().from(book).where(eq(book.id, bookId));
  const languages = await tx
    .select({ language: bookLanguage.language })
    .from(bookLanguage)
    .where(eq(bookLanguage.bookId, bookId))
    .orderBy(asc(bookLanguage.language));

  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const { table } of ARCHIVED) {
    const columns = archivedColumns(table);
    const of = table as PgTable & { bookId: PgColumn };
    const rows = await tx
      .select(Object.fromEntries(columns))
      .from(of)
      .where(eq(of.bookId, bookId))
      // The first columns identify a row: the same book gives the same file.
      .orderBy(...columns.slice(0, 2).map(([, column]) => asc(column)));
    tables[tableName(table)] = rows.map((row) =>
      Object.fromEntries(columns.map(([key]) => [key, written(row[key])])),
    );
  }

  return {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    exportedAt: new Date().toISOString(),
    book: {
      name: header!.name,
      currency: header!.currency,
      defaultLanguage: header!.defaultLanguage,
      createdAt: header!.createdAt.toISOString(),
    },
    languages: languages.map((l) => l.language),
    tables,
  };
}

export type BookArchive = Awaited<ReturnType<typeof exportBook>>;

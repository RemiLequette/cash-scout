import { currencySchema, languageSchema } from "@cash-scout/domain";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Tx } from "../db/client.js";
import { book, bookLanguage, bookMember } from "../db/schema.js";
import { ARCHIVE_FORMAT, ARCHIVE_VERSION } from "./export.js";
import { ARCHIVED, archivedColumns, tableName, type ArchivedTable } from "./tables.js";

/** Rows written by one statement: the database limits its parameters. */
const CHUNK = 1000;

const refuse = (message: string): never => {
  throw new HTTPException(400, { message });
};

const timestamp = z.iso.datetime().transform((text) => new Date(text));
const amount = z
  .string()
  .regex(/^-?\d{1,18}$/)
  .transform((text) => BigInt(text));

/** What a value of a column must be in the file, and what it becomes. */
function valueOf(column: PgColumn): z.ZodType {
  const type = column.getSQLType();
  if (column.enumValues?.length && type !== "text") {
    return z.enum(column.enumValues as [string, ...string[]]);
  }
  if (type === "uuid") return z.uuid();
  if (type === "text" || type.startsWith("char")) return z.string();
  if (type === "integer" || type === "smallint") return z.int();
  if (type === "boolean") return z.boolean();
  if (type === "bigint") return amount;
  if (type === "bigint[]") return z.array(amount);
  if (type === "numeric") return z.string().regex(/^\d{1,30}(\.\d{1,30})?$/);
  if (type === "date") return z.iso.date();
  if (type.startsWith("timestamp")) return timestamp;
  // The two JSON columns: names per language, and the cells of a statement line.
  if (type === "jsonb") {
    return column.name === "raw" ? z.array(z.string()) : z.record(z.string(), z.string());
  }
  // A new type of column must be read here before a book holding one can be imported.
  throw new Error(`No reading of the column type ${type}`);
}

function rowSchema(table: PgTable) {
  return z.strictObject(
    Object.fromEntries(
      archivedColumns(table).map(([key, column]) => {
        const value = column.notNull ? valueOf(column) : valueOf(column).nullable();
        // A column added since the file was written takes its default.
        return [key, !column.notNull || column.hasDefault ? value.optional() : value];
      }),
    ),
  );
}

const headerSchema = z.object({ format: z.literal(ARCHIVE_FORMAT), version: z.int().positive() });

const archiveSchema = z.object({
  book: z.object({
    name: z.string().trim().min(1).max(100),
    currency: currencySchema,
    defaultLanguage: languageSchema,
    createdAt: timestamp,
  }),
  languages: z.array(languageSchema).min(1).max(10),
  tables: z.record(z.string(), z.array(z.unknown())),
});

type Row = Record<string, unknown>;

/** Checks the whole file before anything is written; fails with 400. */
export function readArchive(content: unknown) {
  const header = headerSchema.safeParse(content);
  if (!header.success) return refuse("This is not a book exported by cash-scout");
  if (header.data.version > ARCHIVE_VERSION) {
    return refuse("The file comes from a newer version of cash-scout: update this one first");
  }
  const parsed = archiveSchema.safeParse(content);
  if (!parsed.success) return refuse(`Invalid file: ${parsed.error.issues[0]!.path.join(".")}`);

  const known = new Set(ARCHIVED.map(({ table }) => tableName(table)));
  const unknown = Object.keys(parsed.data.tables).find((name) => !known.has(name));
  if (unknown) return refuse(`Invalid file: unknown table ${unknown}`);

  const rows = new Map<ArchivedTable, Row[]>();
  for (const archived of ARCHIVED) {
    const name = tableName(archived.table);
    const result = z.array(rowSchema(archived.table)).safeParse(parsed.data.tables[name] ?? []);
    if (!result.success) {
      return refuse(`Invalid file: ${name}.${result.error.issues[0]!.path.join(".")}`);
    }
    rows.set(archived, result.data as Row[]);
  }
  return { ...parsed.data, rows };
}

/**
 * Writes the file as a new book owned by `userId`, with new identifiers, so a
 * book can be imported next to its original. Returns the id of the new book.
 */
export async function importBook(
  tx: Tx,
  userId: string,
  archive: ReturnType<typeof readArchive>,
  name = archive.book.name,
): Promise<string> {
  const bookId = crypto.randomUUID();
  await tx.insert(book).values({ ...archive.book, id: bookId, name });
  await tx.insert(bookMember).values({ bookId, userId, role: "owner" });
  const languages = new Set([...archive.languages, archive.book.defaultLanguage]);
  await tx.insert(bookLanguage).values([...languages].map((language) => ({ bookId, language })));

  // The new identifier of each row, by table and old identifier.
  const ids = new Map<PgTable, Map<unknown, string>>();
  for (const [{ table }, rows] of archive.rows) {
    const renumbered = new Map(rows.map((row) => [row.id, crypto.randomUUID() as string]));
    if (rows.some((row) => "id" in row) && renumbered.size !== rows.length) {
      refuse(`Invalid file: ${tableName(table)} has twice the same identifier`);
    }
    ids.set(table, renumbered);
  }

  for (const [{ table, references }, rows] of archive.rows) {
    const values = rows.map((row) => {
      const copy: Row = { ...row, bookId };
      if ("id" in row) copy.id = ids.get(table)!.get(row.id);
      for (const [key, target] of Object.entries(references)) {
        const old = row[key];
        if (old === null || old === undefined) continue;
        // Only what the file holds can be referred to, never another book's row.
        copy[key] =
          ids.get(target)!.get(old) ??
          refuse(`Invalid file: ${tableName(table)}.${key} refers to a missing row`);
      }
      return copy;
    });
    for (let at = 0; at < values.length; at += CHUNK) {
      await tx.insert(table).values(values.slice(at, at + CHUNK));
    }
  }
  return bookId;
}

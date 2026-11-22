/**
 * Imports reference data from CSV files into a book.
 *
 *   pnpm import:reference --book <book id> --user <email> --dir <folder>
 *
 * The folder holds categories.csv, accounts.csv and payment_types.csv (any of
 * them). The import runs as the given user, who must be an editor or owner of
 * the book, and in one transaction: on any error nothing is imported.
 * See docs/import.md for the file format.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { APP_ROLE, createDb, withUser } from "../db/client.js";
import { user } from "../db/schema.js";
import { loadEnv } from "../env.js";
import { requireRole } from "../routes/access.js";
import { ImportError, importReference } from "./reference.js";

const { values } = parseArgs({
  options: {
    book: { type: "string" },
    user: { type: "string" },
    dir: { type: "string" },
  },
});
if (!values.book || !values.user || !values.dir) {
  console.error("Usage: pnpm import:reference --book <book id> --user <email> --dir <folder>");
  process.exit(2);
}

// pnpm runs the script in apps/api; resolve the folder from where the command was typed.
const dir = resolve(process.env.INIT_CWD ?? process.cwd(), values.dir);
const read = (file: string) => {
  const path = join(dir, file);
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
};
const csv = {
  categories: read("categories.csv"),
  accounts: read("accounts.csv"),
  paymentTypes: read("payment_types.csv"),
};
if (!csv.categories && !csv.accounts && !csv.paymentTypes) {
  console.error(`No categories.csv, accounts.csv or payment_types.csv in ${dir}`);
  process.exit(2);
}

const env = loadEnv();
const { db, sql } = createDb(env.databaseUrl, { role: APP_ROLE });
try {
  const [found] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, values.user.toLowerCase()));
  if (!found) {
    throw new ImportError(`No user with the email ${values.user}`);
  }
  const bookId = values.book;
  const summary = await withUser(db, found.id, async (tx) => {
    await requireRole(tx, bookId, found.id, "editor");
    return importReference(tx, bookId, csv);
  });
  console.log("Created:", summary.created);
  console.log("Already there:", summary.existing);
} catch (error) {
  console.error(`Import failed, nothing was imported: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}

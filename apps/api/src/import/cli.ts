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
import { importReference } from "./reference.js";
import { runImport } from "./run.js";

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

const summary = await runImport(values.user, values.book, (tx) =>
  importReference(tx, values.book!, csv),
);
if (summary) {
  console.log("Created:", summary.created);
  console.log("Already there:", summary.existing);
}

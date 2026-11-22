/**
 * Imports journal entries from a CSV file into a book.
 *
 *   pnpm import:journal --book <book id> --user <email> --file <journal.csv>
 *
 * The import runs as the given user, who must be an editor or owner of the
 * book, and in one transaction: on any error nothing is imported.
 * See docs/import.md for the file format.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { importJournal } from "./journal.js";
import { runImport } from "./run.js";

const { values } = parseArgs({
  options: {
    book: { type: "string" },
    user: { type: "string" },
    file: { type: "string" },
  },
});
if (!values.book || !values.user || !values.file) {
  console.error("Usage: pnpm import:journal --book <book id> --user <email> --file <journal.csv>");
  process.exit(2);
}

// pnpm runs the script in apps/api; resolve the file from where the command was typed.
const path = resolve(process.env.INIT_CWD ?? process.cwd(), values.file);
if (!existsSync(path)) {
  console.error(`No file ${path}`);
  process.exit(2);
}
const csv = readFileSync(path, "utf8");

const summary = await runImport(values.user, values.book, (tx) =>
  importJournal(tx, values.book!, csv),
);
if (summary) {
  console.log("Entries created:", summary.created);
}

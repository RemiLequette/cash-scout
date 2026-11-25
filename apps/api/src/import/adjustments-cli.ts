/**
 * Turns the entries of an "Adjustment" sub-category into opening balances.
 *
 *   pnpm migrate:adjustments --book <book id> --user <email> [--name Ajustement] [--apply --backed-up]
 *
 * Without --apply it only reports what it would do. With --apply it moves the
 * adjustments of each account into its opening balance, deletes the entries and
 * the sub-category, in one transaction. Dump the database first (--backed-up
 * says you did): see "Backup" in ARCHITECTURE.md and docs/bank-import.md.
 */
import { parseArgs } from "node:util";
import { convertAdjustments } from "./adjustments.js";
import { runImport } from "./run.js";

const { values } = parseArgs({
  options: {
    book: { type: "string" },
    user: { type: "string" },
    name: { type: "string", default: "Ajustement" },
    apply: { type: "boolean", default: false },
    "backed-up": { type: "boolean", default: false },
  },
});
if (!values.book || !values.user) {
  console.error(
    "Usage: pnpm migrate:adjustments --book <book id> --user <email> [--name Ajustement] [--apply --backed-up]",
  );
  process.exit(2);
}
if (values.apply && !values["backed-up"]) {
  console.error(
    "Dump the database first (see docs/bank-import.md), then add --backed-up to confirm it.",
  );
  process.exit(2);
}

const report = await runImport(values.user, values.book, (tx) =>
  convertAdjustments(tx, values.book!, values.name!, values.apply!),
);
if (report) {
  console.log(values.apply ? "Done." : "Dry run: nothing was changed.");
  console.log("Sub-categories:");
  for (const s of report.subCategories) console.log(`  ${s.name} (category ${s.category})`);
  console.log("Accounts (the sum goes into the opening balance):");
  for (const a of report.accounts) {
    const span = a.months.length > 0 ? `${a.months[0]} → ${a.months[a.months.length - 1]}` : "";
    console.log(`  ${a.name}: ${a.entries} entries, ${a.total} ${a.currency}, ${span}`);
  }
  if (report.emptiedCategories.length > 0) {
    console.log(`Categories left without a sub-category: ${report.emptiedCategories.join(", ")}`);
  }
  if (!values.apply) console.log("Add --apply --backed-up to do it.");
}

/**
 * Files exported before payment types were removed hold them, in a table of their
 * own and in the rows that named one: they are left out, so these files still read.
 */

type Row = Record<string, unknown>;

const isRow = (value: unknown): value is Row => typeof value === "object" && value !== null;

function withoutColumn(row: unknown): unknown {
  if (!isRow(row)) return row;
  const copy = { ...row };
  delete copy.paymentTypeId;
  return copy;
}

/** A rule whose only action was the payment type would have none left. */
const onlyPaid = (row: unknown): row is Row =>
  isRow(row) &&
  row.paymentTypeId != null &&
  row.subCategoryId == null &&
  row.description == null &&
  row.ignore !== true;

export function withoutPaymentTypes(tables: Record<string, unknown[]>): Record<string, unknown[]> {
  const kept = { ...tables };
  delete kept.payment_type;
  const dropped = new Set((kept.import_rule ?? []).filter(onlyPaid).map((rule) => rule.id));
  if (kept.import_rule) {
    kept.import_rule = kept.import_rule.filter((rule) => !onlyPaid(rule)).map(withoutColumn);
  }
  if (kept.journal_entry) kept.journal_entry = kept.journal_entry.map(withoutColumn);
  if (kept.import_line) {
    // The lines such a rule was proposed on proposed nothing else.
    kept.import_line = kept.import_line.map((line) => {
      const copy = withoutColumn(line);
      return isRow(copy) && dropped.has(copy.ruleId) ? { ...copy, ruleId: null } : copy;
    });
  }
  return kept;
}

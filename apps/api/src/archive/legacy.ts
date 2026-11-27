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

const usedVirtual = "The file has a virtual account in use: they no longer exist";

/** The columns that name an account. */
const accountUses: [table: string, column: string][] = [
  ["journal_entry", "accountId"],
  ["category_budget", "accountId"],
  ["import_batch", "accountId"],
  ["import_line", "transferAccountId"],
];

/**
 * Files exported while there were virtual accounts give each account a kind. An
 * unused virtual account is left out; one that holds something cannot be read.
 */
export function withoutAccountKinds(
  tables: Record<string, unknown[]>,
  refuse: (message: string) => never,
): Record<string, unknown[]> {
  const accounts = tables.book_account ?? [];
  const virtual = new Set<unknown>();
  for (const row of accounts) {
    if (!isRow(row) || row.kind !== "virtual") continue;
    if (row.openingBalance != null && row.openingBalance !== "0") refuse(usedVirtual);
    virtual.add(row.id);
  }
  for (const [table, column] of accountUses) {
    if ((tables[table] ?? []).some((row) => isRow(row) && virtual.has(row[column]))) {
      refuse(usedVirtual);
    }
  }
  const kept = accounts
    .filter((row) => !isRow(row) || !virtual.has(row.id))
    .map((row) => {
      if (!isRow(row)) return row;
      const copy = { ...row };
      delete copy.kind;
      return copy;
    });
  return tables.book_account ? { ...tables, book_account: kept } : tables;
}

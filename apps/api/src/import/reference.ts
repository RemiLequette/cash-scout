/**
 * Import of reference data from CSV files (see docs/import.md).
 *
 * - categories.csv: group, category, code, nature, sub_category
 * - accounts.csv: name, kind, currency, low_balance_threshold
 * - payment_types.csv: name
 *
 * Name columns are in the book's default language; a translation goes in a
 * column suffixed with its language: `category@en`, `name@en`.
 * Items that already exist are left as they are, so an import can be re-run.
 */
import { checkNames, currencySchema, parseThreshold, type Names } from "@cash-scout/domain";
import { parse } from "csv-parse/sync";
import { asc, eq } from "drizzle-orm";
import type { Tx } from "../db/client.js";
import {
  bookAccount,
  category,
  categoryGroup,
  nature,
  paymentType,
  subCategory,
} from "../db/schema.js";
import { languagesOf } from "../routes/access.js";

export interface ReferenceCsv {
  categories?: string;
  accounts?: string;
  paymentTypes?: string;
}

export interface ImportSummary {
  created: Record<"groups" | "categories" | "subCategories" | "accounts" | "paymentTypes", number>;
  existing: number;
}

export class ImportError extends Error {}

type Row = Record<string, string>;

/** Byte order mark that some spreadsheet exports put at the start of a file. */
const BOM = new RegExp(`^${String.fromCharCode(0xfeff)}`);

/** Parses CSV text with a header line; the delimiter is a comma or a semicolon. */
export function parseCsv(text: string): Row[] {
  const header = text.replace(BOM, "").split(/\r?\n/, 1)[0] ?? "";
  const delimiter = header.split(";").length > header.split(",").length ? ";" : ",";
  return parse(text, {
    bom: true,
    columns: (names: string[]) => names.map((n) => n.trim().toLowerCase()),
    delimiter,
    skip_empty_lines: true,
    trim: true,
  }) as Row[];
}

/** Names of a column: the base column in the default language, `column@xx` for the others. */
function namesOf(row: Row, column: string, defaultLanguage: string): Names {
  const names: Names = {};
  for (const [key, value] of Object.entries(row)) {
    if (!value) continue;
    if (key === column) names[defaultLanguage] = value;
    else if (key.startsWith(`${column}@`)) names[key.slice(column.length + 1)] = value;
  }
  return names;
}

function required(row: Row, column: string, line: number): string {
  const value = row[column];
  if (!value) {
    throw new ImportError(`Line ${line}: column "${column}" is empty or missing`);
  }
  return value;
}

/** Imports reference data into a book, inside the caller's transaction. */
export async function importReference(
  tx: Tx,
  bookId: string,
  csv: ReferenceCsv,
): Promise<ImportSummary> {
  const { languages, defaultLanguage } = await languagesOf(tx, bookId);
  const summary: ImportSummary = {
    created: { groups: 0, categories: 0, subCategories: 0, accounts: 0, paymentTypes: 0 },
    existing: 0,
  };

  function checked(names: Names, line: number): Names {
    const problem = checkNames(names, languages, defaultLanguage);
    if (problem) throw new ImportError(`Line ${line}: ${problem}`);
    return names;
  }
  const key = (names: Names) => (names[defaultLanguage] ?? "").toLocaleLowerCase();

  if (csv.categories) {
    const rows = parseCsv(csv.categories);
    const groups = new Map(
      (await tx.select().from(categoryGroup).where(eq(categoryGroup.bookId, bookId))).map((g) => [
        key(g.names),
        g.id,
      ]),
    );
    const categories = new Map(
      (await tx.select().from(category).where(eq(category.bookId, bookId))).map((c) => [
        c.code,
        c.id,
      ]),
    );
    // A category names its nature, in any of the languages of the book.
    const natures = await tx
      .select()
      .from(nature)
      .where(eq(nature.bookId, bookId))
      .orderBy(asc(nature.position));
    const subCategories = new Set(
      (await tx.select().from(subCategory).where(eq(subCategory.bookId, bookId))).map(
        (s) => `${s.categoryId}|${key(s.names)}`,
      ),
    );

    for (const [index, row] of rows.entries()) {
      const line = index + 2;
      const groupNames = checked(namesOf(row, "group", defaultLanguage), line);
      let groupId = groups.get(key(groupNames));
      if (!groupId) {
        const [created] = await tx
          .insert(categoryGroup)
          .values({ bookId, names: groupNames, position: groups.size })
          .returning({ id: categoryGroup.id });
        groupId = created!.id;
        groups.set(key(groupNames), groupId);
        summary.created.groups++;
      }

      const code = required(row, "code", line);
      let categoryId = categories.get(code);
      if (!categoryId) {
        const wanted = required(row, "nature", line).toLowerCase();
        const natureOf = natures.find(
          (n) =>
            !n.archivedAt && Object.values(n.names).some((name) => name.toLowerCase() === wanted),
        );
        if (!natureOf) {
          throw new ImportError(`Line ${line}: the book has no nature named "${row.nature}"`);
        }
        const [created] = await tx
          .insert(category)
          .values({
            bookId,
            groupId,
            code,
            natureId: natureOf.id,
            names: checked(namesOf(row, "category", defaultLanguage), line),
          })
          .returning({ id: category.id });
        categoryId = created!.id;
        categories.set(code, categoryId);
        summary.created.categories++;
      }

      if (row.sub_category) {
        const names = checked(namesOf(row, "sub_category", defaultLanguage), line);
        const id = `${categoryId}|${key(names)}`;
        if (subCategories.has(id)) {
          summary.existing++;
        } else {
          await tx.insert(subCategory).values({ bookId, categoryId, names });
          subCategories.add(id);
          summary.created.subCategories++;
        }
      }
    }
  }

  if (csv.accounts) {
    const existing = new Set(
      (await tx.select().from(bookAccount).where(eq(bookAccount.bookId, bookId))).map((a) =>
        key(a.names),
      ),
    );
    for (const [index, row] of parseCsv(csv.accounts).entries()) {
      const line = index + 2;
      const names = checked(namesOf(row, "name", defaultLanguage), line);
      if (existing.has(key(names))) {
        summary.existing++;
        continue;
      }
      const kind = (row.kind || "bank").toLowerCase();
      if (kind !== "bank" && kind !== "virtual") {
        throw new ImportError(`Line ${line}: unknown kind "${row.kind}" (bank or virtual)`);
      }
      const currency = currencySchema.safeParse(required(row, "currency", line).toUpperCase());
      if (!currency.success) {
        throw new ImportError(`Line ${line}: unknown currency "${row.currency}"`);
      }
      let lowBalanceThreshold: bigint | null;
      try {
        lowBalanceThreshold = parseThreshold(
          row.low_balance_threshold?.replace(",", "."),
          currency.data,
        );
      } catch (error) {
        throw new ImportError(`Line ${line}: ${(error as Error).message}`);
      }
      await tx
        .insert(bookAccount)
        .values({ bookId, names, kind, currency: currency.data, lowBalanceThreshold });
      existing.add(key(names));
      summary.created.accounts++;
    }
  }

  if (csv.paymentTypes) {
    const existing = new Set(
      (await tx.select().from(paymentType).where(eq(paymentType.bookId, bookId))).map((p) =>
        key(p.names),
      ),
    );
    for (const [index, row] of parseCsv(csv.paymentTypes).entries()) {
      const names = checked(namesOf(row, "name", defaultLanguage), index + 2);
      if (existing.has(key(names))) {
        summary.existing++;
        continue;
      }
      await tx.insert(paymentType).values({ bookId, names });
      existing.add(key(names));
      summary.created.paymentTypes++;
    }
  }

  return summary;
}

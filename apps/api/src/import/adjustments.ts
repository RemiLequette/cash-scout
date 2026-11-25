import { money, toDecimalString } from "@cash-scout/domain";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "../db/client.js";
import { bookAccount, category, journalEntry, subCategory } from "../db/schema.js";
import { languagesOf } from "../routes/access.js";
import { ImportError } from "./reference.js";

/** What turning a book's adjustments into opening balances does, account by account. */
export interface AdjustmentReport {
  subCategories: { id: string; name: string; category: string }[];
  accounts: {
    accountId: string;
    name: string;
    currency: string;
    entries: number;
    /** Sum of the adjustments, in the account currency: it goes into the opening balance. */
    total: string;
    months: string[];
  }[];
  /** Categories left without a sub-category once the adjustments are gone. */
  emptiedCategories: string[];
}

/**
 * Moves the entries of the sub-category called `name` (in any language of the
 * book) into the opening balance of their account, then deletes the entries and
 * the sub-category. The balance of every account stays what it was.
 *
 * Without `apply` nothing changes: the report says what would. Entries that are
 * part of a transfer stop it: they are not adjustments.
 */
export async function convertAdjustments(
  tx: Tx,
  bookId: string,
  name: string,
  apply: boolean,
): Promise<AdjustmentReport> {
  const { defaultLanguage } = await languagesOf(tx, bookId);
  const wanted = name.trim().toLocaleLowerCase();
  const nameOf = (names: Record<string, string>) =>
    names[defaultLanguage] ?? Object.values(names)[0] ?? "";

  const subs = await tx
    .select({
      id: subCategory.id,
      names: subCategory.names,
      categoryId: subCategory.categoryId,
      categoryNames: category.names,
    })
    .from(subCategory)
    .innerJoin(category, eq(category.id, subCategory.categoryId))
    .where(eq(subCategory.bookId, bookId));
  const found = subs.filter((s) =>
    Object.values(s.names).some((n) => n.trim().toLocaleLowerCase() === wanted),
  );
  if (found.length === 0) {
    throw new ImportError(`No sub-category named "${name}" in this book`);
  }
  const ids = found.map((s) => s.id);

  const entries = await tx
    .select({
      accountId: journalEntry.accountId,
      date: journalEntry.date,
      amount: journalEntry.amount,
      bookAmount: journalEntry.bookAmount,
      transferId: journalEntry.transferId,
    })
    .from(journalEntry)
    .where(and(eq(journalEntry.bookId, bookId), inArray(journalEntry.subCategoryId, ids)));
  if (entries.some((e) => e.transferId !== null)) {
    throw new ImportError(`"${name}" holds entries of transfers: they are not adjustments`);
  }

  const accounts = await tx
    .select({ id: bookAccount.id, names: bookAccount.names, currency: bookAccount.currency })
    .from(bookAccount)
    .where(eq(bookAccount.bookId, bookId));
  const perAccount = new Map<
    string,
    { entries: number; total: bigint; bookTotal: bigint; months: Set<string> }
  >();
  for (const e of entries) {
    const row = perAccount.get(e.accountId) ?? {
      entries: 0,
      total: 0n,
      bookTotal: 0n,
      months: new Set<string>(),
    };
    row.entries += 1;
    row.total += e.amount;
    row.bookTotal += e.bookAmount;
    row.months.add(e.date.slice(0, 7));
    perAccount.set(e.accountId, row);
  }

  const categoryIds = new Set(found.map((s) => s.categoryId));
  const emptied = [...categoryIds].filter((id) =>
    subs.filter((s) => s.categoryId === id).every((s) => ids.includes(s.id)),
  );

  const report: AdjustmentReport = {
    subCategories: found.map((s) => ({
      id: s.id,
      name: nameOf(s.names),
      category: nameOf(s.categoryNames),
    })),
    accounts: accounts.flatMap((a) => {
      const row = perAccount.get(a.id);
      return row
        ? [
            {
              accountId: a.id,
              name: nameOf(a.names),
              currency: a.currency,
              entries: row.entries,
              total: toDecimalString(money(row.total, a.currency)),
              months: [...row.months].sort(),
            },
          ]
        : [];
    }),
    emptiedCategories: emptied.map((id) =>
      nameOf(subs.find((s) => s.categoryId === id)!.categoryNames),
    ),
  };

  if (apply) {
    for (const [accountId, row] of perAccount) {
      await tx
        .update(bookAccount)
        .set({
          openingBalance: sql`${bookAccount.openingBalance} + ${row.total.toString()}::bigint`,
          openingBookAmount: sql`${bookAccount.openingBookAmount} + ${row.bookTotal.toString()}::bigint`,
        })
        .where(and(eq(bookAccount.id, accountId), eq(bookAccount.bookId, bookId)));
    }
    await tx
      .delete(journalEntry)
      .where(and(eq(journalEntry.bookId, bookId), inArray(journalEntry.subCategoryId, ids)));
    await tx
      .delete(subCategory)
      .where(and(eq(subCategory.bookId, bookId), inArray(subCategory.id, ids)));
  }
  return report;
}

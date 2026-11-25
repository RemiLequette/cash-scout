import {
  addDays,
  bookAmount,
  decide,
  firstRule,
  matchLines,
  matchWindowDays,
  money,
  openingFromBalance,
  resolveRate,
  type ImportRequest,
  type LineChange,
} from "@cash-scout/domain";
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { Tx } from "../db/client.js";
import {
  bookAccount,
  importBatch,
  importLine,
  importRule,
  journalEntry,
  subCategory,
} from "../db/schema.js";
import { checked } from "../routes/access.js";
import { bookCurrencyOf } from "../routes/journal.js";

/** The review of an import batch and its import into the journal. */

const bad = (message: string) => new HTTPException(400, { message });

export async function batchOf(tx: Tx, bookId: string, id: string, lock = false) {
  const query = tx
    .select({
      id: importBatch.id,
      accountId: importBatch.accountId,
      preset: importBatch.preset,
      fileName: importBatch.fileName,
      createdAt: importBatch.createdAt,
    })
    .from(importBatch)
    .where(and(eq(importBatch.id, id), eq(importBatch.bookId, bookId)));
  // The lock keeps two imports of the same batch from both creating its entries.
  const [batch] = await (lock ? query.for("update") : query);
  if (!batch) {
    throw new HTTPException(404, { message: "Batch not found" });
  }
  const [account] = await tx
    .select({
      currency: bookAccount.currency,
      openingBalance: bookAccount.openingBalance,
      archivedAt: bookAccount.archivedAt,
    })
    .from(bookAccount)
    .where(eq(bookAccount.id, batch.accountId));
  return { ...batch, account: account! };
}

export function linesOf(tx: Tx, batchId: string) {
  return tx
    .select()
    .from(importLine)
    .where(eq(importLine.batchId, batchId))
    .orderBy(desc(importLine.date), asc(importLine.row));
}
type Line = Awaited<ReturnType<typeof linesOf>>[number];

const entryColumns = {
  id: journalEntry.id,
  date: journalEntry.date,
  amount: journalEntry.amount,
  reconciled: journalEntry.reconciled,
  description: journalEntry.description,
  subCategoryId: journalEntry.subCategoryId,
  transferId: journalEntry.transferId,
};
export type CandidateEntry = Awaited<ReturnType<typeof entriesByIds>>[number];

function entriesByIds(tx: Tx, bookId: string, ids: string[]) {
  return tx
    .select(entryColumns)
    .from(journalEntry)
    .where(and(eq(journalEntry.bookId, bookId), inArray(journalEntry.id, ids)));
}

/** The entries that some statement line already is, whatever its batch. */
async function claimedEntries(tx: Tx, bookId: string) {
  const rows = await tx
    .select({ lineId: importLine.id, entryId: importLine.entryId })
    .from(importLine)
    .where(and(eq(importLine.bookId, bookId), isNotNull(importLine.entryId)));
  return new Map(rows.map((r) => [r.entryId!, r.lineId]));
}

/**
 * The journal entries each undecided line may already be, and every entry the
 * lines refer to (proposed or chosen), by id.
 */
export async function proposals(tx: Tx, bookId: string, accountId: string, lines: readonly Line[]) {
  const open = lines.filter((l) => l.status === "review");
  const entries = new Map<string, CandidateEntry>();
  let matches = new Map<string, string[]>();
  if (open.length > 0) {
    const dates = open.map((l) => l.date).sort();
    const claimed = await claimedEntries(tx, bookId);
    const around = await tx
      .select(entryColumns)
      .from(journalEntry)
      .where(
        and(
          eq(journalEntry.bookId, bookId),
          eq(journalEntry.accountId, accountId),
          gte(journalEntry.date, addDays(dates[0]!, -matchWindowDays)),
          lte(journalEntry.date, addDays(dates.at(-1)!, matchWindowDays)),
        ),
      );
    const free = around.filter((e) => !claimed.has(e.id));
    matches = matchLines(open, free);
    for (const entry of free) entries.set(entry.id, entry);
  }
  const chosen = lines.flatMap((l) => (l.entryId ? [l.entryId] : []));
  if (chosen.length > 0) {
    for (const entry of await entriesByIds(tx, bookId, chosen)) entries.set(entry.id, entry);
  }
  return { matches, entries };
}

/** Applies the user's decisions to the lines of a batch. */
export async function applyChanges(
  tx: Tx,
  bookId: string,
  batchId: string,
  changes: readonly LineChange[],
) {
  const batch = await batchOf(tx, bookId, batchId, true);
  const lines = new Map((await linesOf(tx, batchId)).map((l) => [l.id, l]));
  const claimed = await claimedEntries(tx, bookId);

  const subIds = [...new Set(changes.flatMap((c) => (c.subCategoryId ? [c.subCategoryId] : [])))];
  if (subIds.length > 0) {
    const found = await tx
      .select({ id: subCategory.id, archivedAt: subCategory.archivedAt })
      .from(subCategory)
      .where(and(eq(subCategory.bookId, bookId), inArray(subCategory.id, subIds)));
    if (found.length !== subIds.length) throw bad("Unknown sub-category");
    if (found.some((s) => s.archivedAt)) throw bad("The sub-category is archived");
  }
  const entryIds = [...new Set(changes.flatMap((c) => (c.entryId ? [c.entryId] : [])))];
  const entries = new Map(
    entryIds.length === 0
      ? []
      : (
          await tx
            .select({
              id: journalEntry.id,
              accountId: journalEntry.accountId,
              amount: journalEntry.amount,
            })
            .from(journalEntry)
            .where(and(eq(journalEntry.bookId, bookId), inArray(journalEntry.id, entryIds)))
        ).map((e) => [e.id, e]),
  );

  for (const change of changes) {
    const line = lines.get(change.id);
    if (!line) throw bad("Unknown line");
    const next = checked(() => decide(line, change));
    if (change.entryId) {
      const entry = entries.get(change.entryId);
      if (!entry || entry.accountId !== batch.accountId || entry.amount !== line.amount) {
        throw bad("The entry is not of this account and amount");
      }
      const owner = claimed.get(change.entryId);
      if (owner !== undefined && owner !== line.id) {
        throw bad("Another statement line is already this entry");
      }
    }
    if (line.entryId && line.entryId !== next.entryId) claimed.delete(line.entryId);
    if (next.entryId) claimed.set(next.entryId, line.id);
    const description =
      change.description === undefined ? line.description : change.description || null;
    Object.assign(line, next, { description });
    await tx
      .update(importLine)
      .set({ ...next, description })
      .where(eq(importLine.id, line.id));
  }
}

/** The statement's balance at its last date with one: the most frequent that day. */
function lastBalance(lines: readonly Line[]) {
  const dated = lines.filter((l) => l.balance !== null);
  if (dated.length === 0) return null;
  const date = dated
    .map((l) => l.date)
    .sort()
    .at(-1)!;
  const seen = new Map<bigint, number>();
  for (const line of dated) {
    if (line.date === date) seen.set(line.balance!, (seen.get(line.balance!) ?? 0) + 1);
  }
  return { date, balance: [...seen].sort((a, b) => b[1] - a[1])[0]![0] };
}

/**
 * The opening balance the statement gives once every validated line is in the
 * journal. Offered only when no line is left to review: a line imported later
 * would otherwise be counted twice. Null when it cannot be told.
 */
export async function openingOf(
  tx: Tx,
  accountId: string,
  lines: readonly Line[],
): Promise<{ date: string; balance: bigint; proposed: bigint; suggested: boolean } | null> {
  const last = lastBalance(lines);
  if (!last || lines.some((l) => l.status === "review")) return null;

  // Reconciled up to the statement's date, and whatever the batch's lines are even if dated later.
  const ofBatch = lines.flatMap((l) => (l.entryId && l.status !== "ignored" ? [l.entryId] : []));
  const [sum] = await tx
    .select({ total: sql<string>`coalesce(sum(${journalEntry.amount}), 0)` })
    .from(journalEntry)
    .where(
      and(
        eq(journalEntry.accountId, accountId),
        eq(journalEntry.reconciled, true),
        or(
          lte(journalEntry.date, last.date),
          ofBatch.length > 0 ? inArray(journalEntry.id, ofBatch) : undefined,
        ),
      ),
    );
  // What the import is about to reconcile: new entries, and forecasts matched.
  const pending = lines.filter((l) => l.status === "validated");
  const matched = pending.flatMap((l) => (l.entryId ? [l.entryId] : []));
  const forecasts = new Set(
    matched.length === 0
      ? []
      : (
          await tx
            .select({ id: journalEntry.id })
            .from(journalEntry)
            .where(and(inArray(journalEntry.id, matched), eq(journalEntry.reconciled, false)))
        ).map((e) => e.id),
  );
  const added = pending
    .filter((l) => !l.entryId || forecasts.has(l.entryId))
    .reduce((total, l) => total + l.amount, 0n);
  const [history] = await tx
    .select({ id: journalEntry.id })
    .from(journalEntry)
    .where(eq(journalEntry.accountId, accountId))
    .limit(1);
  return {
    suggested: history === undefined,
    date: last.date,
    balance: last.balance,
    proposed: openingFromBalance(last.balance, BigInt(sum!.total) + added),
  };
}

/**
 * Writes the validated lines of a batch into the journal, all or nothing: a line
 * with a sub-category becomes a reconciled entry, a line matched to an entry
 * reconciles it and dates it as the bank does (a side of a transfer keeps its
 * date). Sets the opening balance too when asked.
 */
export async function importBatchLines(
  tx: Tx,
  bookId: string,
  batchId: string,
  request: Omit<ImportRequest, "setOpening"> & { setOpening: boolean },
) {
  const batch = await batchOf(tx, bookId, batchId, true);
  const { currency, archivedAt } = batch.account;
  if (archivedAt) throw bad("The account is archived");
  const lines = await linesOf(tx, batchId);
  const pending = lines.filter((l) => l.status === "validated");
  const opening = request.setOpening ? await openingOf(tx, batch.accountId, lines) : null;
  if (request.setOpening && !opening) {
    throw bad("The opening balance needs a statement balance and no line left to review");
  }
  if (pending.length === 0 && !opening) throw bad("No validated line to import");

  const bookCurrency = await bookCurrencyOf(tx, bookId);
  const rate = checked(() => resolveRate(currency, bookCurrency, request.exchangeRate));
  const inBook = (minor: bigint) =>
    checked(() => bookAmount(money(minor, currency), rate, bookCurrency)).minor;

  let created = 0;
  let matched = 0;
  for (const line of pending) {
    let entryId = line.entryId;
    let previous: { previousDate: string; previousReconciled: boolean } | null = null;
    if (entryId) {
      const [entry] = await tx
        .select({
          accountId: journalEntry.accountId,
          amount: journalEntry.amount,
          transferId: journalEntry.transferId,
          date: journalEntry.date,
          reconciled: journalEntry.reconciled,
        })
        .from(journalEntry)
        .where(and(eq(journalEntry.id, entryId), eq(journalEntry.bookId, bookId)));
      if (!entry || entry.accountId !== batch.accountId || entry.amount !== line.amount) {
        throw new HTTPException(409, {
          message: `The entry matched to the line of ${line.date} has changed: review it again`,
        });
      }
      await tx
        .update(journalEntry)
        .set({ reconciled: true, ...(entry.transferId ? {} : { date: line.date }) })
        .where(eq(journalEntry.id, entryId));
      previous = { previousDate: entry.date, previousReconciled: entry.reconciled };
      matched++;
    } else {
      if (!line.subCategoryId) {
        throw new HTTPException(409, {
          message: `The line of ${line.date} has no sub-category or entry: review it again`,
        });
      }
      const description = line.description ?? (line.counterparty || line.label);
      const [entry] = await tx
        .insert(journalEntry)
        .values({
          bookId,
          date: line.date,
          accountId: batch.accountId,
          subCategoryId: line.subCategoryId,
          description: description.slice(0, 500),
          amount: line.amount,
          plannedAmount: 0n,
          exchangeRate: rate,
          bookAmount: inBook(line.amount),
          reconciled: true,
          importBatchId: batch.id,
        })
        .returning({ id: journalEntry.id });
      entryId = entry!.id;
      created++;
    }
    await tx
      .update(importLine)
      .set({ status: "imported", entryId, ...previous })
      .where(eq(importLine.id, line.id));
  }

  if (opening) {
    await tx
      .update(bookAccount)
      .set({ openingBalance: opening.proposed, openingBookAmount: inBook(opening.proposed) })
      .where(eq(bookAccount.id, batch.accountId));
  }
  return { created, matched, openingSet: opening !== null };
}

/**
 * Undoes the import of a batch: the entries it created are deleted, the entries it
 * reconciled get their date and flag back, and its lines are validated again, ready
 * to be changed or imported anew. The opening balance is left as it is. An entry
 * the user changed or deleted since is not touched, and counted in `skipped`.
 */
export async function undoImport(tx: Tx, bookId: string, batchId: string) {
  const batch = await batchOf(tx, bookId, batchId, true);
  const lines = (await linesOf(tx, batchId)).filter((l) => l.status === "imported");
  if (lines.length === 0) throw bad("Nothing was imported from this batch");

  let removed = 0;
  let restored = 0;
  let skipped = 0;
  for (const line of lines) {
    if (line.entryId === null) {
      skipped++;
    } else if (line.previousReconciled === null) {
      // Created by the import: only while it still is what the import wrote.
      const gone = await tx
        .delete(journalEntry)
        .where(
          and(
            eq(journalEntry.id, line.entryId),
            eq(journalEntry.bookId, bookId),
            eq(journalEntry.importBatchId, batch.id),
            eq(journalEntry.amount, line.amount),
          ),
        )
        .returning({ id: journalEntry.id });
      if (gone.length > 0) removed++;
      else skipped++;
    } else {
      const back = await tx
        .update(journalEntry)
        .set({
          reconciled: line.previousReconciled,
          ...(line.previousDate === null ? {} : { date: line.previousDate }),
        })
        .where(
          and(
            eq(journalEntry.id, line.entryId),
            eq(journalEntry.bookId, bookId),
            eq(journalEntry.amount, line.amount),
          ),
        )
        .returning({ id: journalEntry.id, transferId: journalEntry.transferId });
      if (back.length > 0) restored++;
      else skipped++;
    }
    // A created entry is gone, its line goes back to choosing a sub-category; a matched one is still the line's entry.
    await tx
      .update(importLine)
      .set({
        status: "validated",
        previousDate: null,
        previousReconciled: null,
        ...(line.previousReconciled === null ? { entryId: null } : {}),
      })
      .where(eq(importLine.id, line.id));
  }
  return { removed, restored, skipped };
}

/**
 * Proposes what the book's rules say for the lines of a batch that have nothing
 * chosen yet (no sub-category, no entry): the first rule that fits sets its
 * sub-category and description, or marks the line to be ignored; a line a rule already
 * proposed something for is left as it is. The lines stay
 * to review: the user accepts the proposals. Returns how many lines a rule hit.
 */
export async function applyRules(tx: Tx, bookId: string, batchId: string) {
  const batch = await batchOf(tx, bookId, batchId);
  const archived = new Set(
    (
      await tx
        .select({ id: subCategory.id })
        .from(subCategory)
        .where(and(eq(subCategory.bookId, bookId), isNotNull(subCategory.archivedAt)))
    ).map((s) => s.id),
  );
  const rules = (
    await tx
      .select()
      .from(importRule)
      .where(eq(importRule.bookId, bookId))
      .orderBy(asc(importRule.position), asc(importRule.createdAt))
  ).filter((rule) => !rule.subCategoryId || !archived.has(rule.subCategoryId));
  if (rules.length === 0) return 0;

  const hits = new Map<string, string[]>();
  for (const line of await linesOf(tx, batchId)) {
    if (line.status !== "review" || line.subCategoryId || line.entryId || line.ruleId) continue;
    const rule = firstRule(rules, {
      accountId: batch.accountId,
      currency: batch.account.currency,
      amount: line.amount,
      counterparty: line.counterparty,
      label: line.label,
      memo: line.memo,
      bankCategory: line.bankCategory,
    });
    if (rule) hits.set(rule.id, [...(hits.get(rule.id) ?? []), line.id]);
  }
  let applied = 0;
  for (const [ruleId, ids] of hits) {
    const rule = rules.find((r) => r.id === ruleId)!;
    await tx
      .update(importLine)
      .set({ ruleId, subCategoryId: rule.subCategoryId, description: rule.description })
      .where(inArray(importLine.id, ids));
    applied += ids.length;
  }
  return applied;
}

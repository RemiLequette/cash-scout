import { zValidator } from "@hono/zod-validator";
import {
  importRequestSchema,
  lineFingerprints,
  money,
  previewOf,
  reviewChangesSchema,
  toDecimalString,
} from "@cash-scout/domain";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { withUser, type Db } from "../db/client.js";
import { importBatch, importLine } from "../db/schema.js";
import type { AppEnv } from "../http.js";
import { readStatementFile } from "../statements/file.js";
import { presets } from "../statements/presets.js";
import { statementRuleRoutes } from "./statement-rules.js";
import {
  applyChanges,
  applyRules,
  batchOf,
  importBatchLines,
  linesOf,
  openingOf,
  proposals,
  undoImport,
  type CandidateEntry,
} from "../statements/review.js";
import { idOf, requireRole } from "./access.js";
import { accountOf, bookCurrencyOf, usable } from "./journal.js";

/** A statement is a few hundred lines: a megabyte is far more than a year of them. */
const MAX_BYTES = 5 * 1024 * 1024;

/** Lines go into the database a few hundred at a time, within the parameter limit. */
const CHUNK = 500;

/** What an upload names: the file's bytes, its name, its bank format and its account. */
async function readUpload(query: Record<string, string>, body: ArrayBuffer) {
  const preset = presets.find((p) => p.id === query.preset);
  if (!preset) {
    throw new HTTPException(400, { message: "Unknown statement format" });
  }
  const accountId = idOf(query.account ?? "", "Account");
  const content = new Uint8Array(body);
  if (content.length === 0) {
    throw new HTTPException(400, { message: "The file is empty" });
  }
  if (content.length > MAX_BYTES) {
    throw new HTTPException(413, { message: "The file is too large" });
  }
  return { preset, accountId, content, name: (query.name ?? "statement.csv").slice(0, 200) };
}

/** Reads the uploaded file with its format; a file of another format is a 400. */
function parseUpload(file: Awaited<ReturnType<typeof readUpload>>, currency: string) {
  try {
    return readStatementFile(file.content, file.preset, currency);
  } catch (error) {
    if (error instanceof RangeError) {
      throw new HTTPException(400, {
        message: `This file does not look like a ${file.preset.name} statement: ${error.message}`,
      });
    }
    throw error;
  }
}

/**
 * Bank statements, mounted under /books/:bookId/statements. Only editors and
 * owners reach them: a statement holds account numbers and labels. Reading a
 * file for a preview writes nothing; a batch keeps the lines to review.
 */
export function statementRoutes(db: Db) {
  return (
    new Hono<AppEnv>()
      .route("/rules", statementRuleRoutes(db))

      .get("/presets", async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        await withUser(db, me, (tx) => requireRole(tx, bookId, me, "editor"));
        return c.json(presets.map(({ id, name }) => ({ id, name })));
      })

      // The body is the file itself; the query names the preset and the account,
      // whose currency the amounts are read in.
      .post("/preview", async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const file = await readUpload(c.req.query(), await c.req.arrayBuffer());
        const account = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          return usable(accountOf(tx, bookId, file.accountId), "account");
        });
        const parsed = parseUpload(file, account.currency);
        return c.json(previewOf(parsed, account.currency));
      })

      // Keeps a statement file as an import batch to review, with its lines.
      .post("/batches", async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const file = await readUpload(c.req.query(), await c.req.arrayBuffer());
        const created = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const account = await usable(accountOf(tx, bookId, file.accountId), "account");
          const parsed = parseUpload(file, account.currency);
          if (parsed.lines.length === 0) {
            throw new HTTPException(400, { message: "The file holds no line to import" });
          }
          const [batch] = await tx
            .insert(importBatch)
            .values({
              bookId,
              accountId: file.accountId,
              preset: file.preset.id,
              fileName: file.name,
              createdBy: me,
            })
            .returning({ id: importBatch.id });
          const prints = lineFingerprints(parsed.lines);
          const rows = parsed.lines.map((line, i) => ({
            bookId,
            batchId: batch!.id,
            row: line.row,
            date: line.date,
            valueDate: line.valueDate,
            amount: line.amount,
            label: line.label,
            counterparty: line.counterparty,
            memo: line.memo,
            reference: line.reference,
            bankCategory: line.bankCategory,
            balance: line.balance,
            accountNumber: line.accountNumber,
            raw: line.raw,
            fingerprint: prints[i]!,
          }));
          for (let i = 0; i < rows.length; i += CHUNK) {
            await tx.insert(importLine).values(rows.slice(i, i + CHUNK));
          }
          const proposed = await applyRules(tx, bookId, batch!.id);
          return { id: batch!.id, lines: rows.length, skipped: parsed.errors.length, proposed };
        });
        return c.json(created, 201);
      })

      // The batches of the book, with how far their review is.
      .get("/batches", async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const rows = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          return tx
            .select({
              id: importBatch.id,
              accountId: importBatch.accountId,
              preset: importBatch.preset,
              fileName: importBatch.fileName,
              createdAt: importBatch.createdAt,
              lines: sql<number>`count(${importLine.id})::int`,
              toReview: sql<number>`(count(${importLine.id}) filter (where ${importLine.status} = 'review'))::int`,
              from: sql<string | null>`min(${importLine.date})`,
              to: sql<string | null>`max(${importLine.date})`,
            })
            .from(importBatch)
            .leftJoin(importLine, eq(importLine.batchId, importBatch.id))
            .where(eq(importBatch.bookId, bookId))
            .groupBy(importBatch.id)
            .orderBy(desc(importBatch.createdAt));
        });
        return c.json(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
      })

      // One batch with its lines, what was decided for them, the entries of the
      // journal they may be, and the opening balance the statement gives. A line
      // is flagged as a duplicate when an earlier batch of the same account
      // already holds it (same date, amount, label and rank).
      .get("/batches/:id", async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Batch");
        const result = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const batch = await batchOf(tx, bookId, id);
          const seen = await tx.execute<{ id: string }>(sql`
            select line.id from import_line line
            where line.batch_id = ${id} and exists (
              select 1 from import_line other
              join import_batch earlier on earlier.id = other.batch_id
              where other.book_id = ${bookId}
                and other.fingerprint = line.fingerprint
                and earlier.account_id = ${batch.accountId}
                and (earlier.created_at, earlier.id) < (${batch.createdAt.toISOString()}::timestamptz, ${batch.id}::uuid)
            )`);
          const lines = await linesOf(tx, id);
          return {
            batch,
            lines,
            duplicates: new Set([...seen].map((r) => r.id)),
            ...(await proposals(tx, bookId, batch.accountId, lines)),
            opening: await openingOf(tx, batch.accountId, lines),
            bookCurrency: await bookCurrencyOf(tx, bookId),
          };
        });
        const { batch, entries, matches, forecasts, unmatched, opening } = result;
        const { currency } = batch.account;
        const text = (minor: bigint) => toDecimalString(money(minor, currency));
        const outEntry = (entry: CandidateEntry) => ({
          id: entry.id,
          date: entry.date,
          amount: text(entry.amount),
          description: entry.description,
          subCategoryId: entry.subCategoryId,
          reconciled: entry.reconciled,
          transfer: entry.transferId !== null,
        });
        const entryOf = (entryId: string) => outEntry(entries.get(entryId)!);
        return c.json({
          id: batch.id,
          accountId: batch.accountId,
          preset: batch.preset,
          fileName: batch.fileName,
          createdAt: batch.createdAt.toISOString(),
          currency,
          bookCurrency: result.bookCurrency,
          lines: result.lines.map((l) => ({
            id: l.id,
            row: l.row,
            date: l.date,
            amount: text(l.amount),
            label: l.label,
            counterparty: l.counterparty,
            memo: l.memo,
            bankCategory: l.bankCategory,
            balance: l.balance === null ? null : text(l.balance),
            status: l.status,
            subCategoryId: l.subCategoryId,
            description: l.description,
            ruleId: l.ruleId,
            paymentTypeId: l.paymentTypeId,
            transferAccountId: l.transferAccountId,
            entry: l.entryId && entries.has(l.entryId) ? entryOf(l.entryId) : null,
            candidates: (matches.get(l.id) ?? []).map(entryOf),
            duplicate: result.duplicates.has(l.id),
          })),
          // Forecasts no line is: to choose by hand, and the ones the statement should hold.
          forecasts: forecasts.filter((e) => e.transferId === null).map(outEntry),
          unmatched: unmatched.map(outEntry),
          opening: opening && {
            date: opening.date,
            balance: text(opening.balance),
            current: text(batch.account.openingBalance),
            proposed: text(opening.proposed),
            suggested: opening.suggested,
          },
        });
      })

      // Tries the rules again on the lines that have nothing chosen yet.
      .post("/batches/:id/rules", async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Batch");
        const applied = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          await batchOf(tx, bookId, id);
          return applyRules(tx, bookId, id);
        });
        return c.json({ applied });
      })

      // The user's decisions on some lines: all are applied, or none.
      .patch("/batches/:id/lines", zValidator("json", reviewChangesSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Batch");
        const { changes } = c.req.valid("json");
        await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          await applyChanges(tx, bookId, id, changes);
        });
        return c.body(null, 204);
      })

      .post("/batches/:id/import", zValidator("json", importRequestSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Batch");
        const request = c.req.valid("json");
        const result = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          return importBatchLines(tx, bookId, id, request);
        });
        return c.json(result);
      })

      // Gives the journal back what the import changed.
      .post("/batches/:id/undo", async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Batch");
        const result = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          return undoImport(tx, bookId, id);
        });
        return c.json(result);
      })

      .delete("/batches/:id", async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Batch");
        await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          // Its lines go with it.
          const deleted = await tx
            .delete(importBatch)
            .where(and(eq(importBatch.id, id), eq(importBatch.bookId, bookId)))
            .returning({ id: importBatch.id });
          if (deleted.length === 0) {
            throw new HTTPException(404, { message: "Batch not found" });
          }
        });
        return c.body(null, 204);
      })
  );
}

import { lineFingerprints, money, previewOf, toDecimalString } from "@cash-scout/domain";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { withUser, type Db } from "../db/client.js";
import { bookAccount, importBatch, importLine } from "../db/schema.js";
import type { AppEnv } from "../http.js";
import { readStatementFile } from "../statements/file.js";
import { presets } from "../statements/presets.js";
import { idOf, requireRole } from "./access.js";
import { accountOf, usable } from "./journal.js";

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
          return { id: batch!.id, lines: rows.length, skipped: parsed.errors.length };
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

      // One batch with its lines. A line is flagged as a duplicate when an earlier
      // batch of the same account already holds it (same date, amount, label and rank).
      .get("/batches/:id", async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Batch");
        const result = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const [batch] = await tx
            .select({
              id: importBatch.id,
              accountId: importBatch.accountId,
              preset: importBatch.preset,
              fileName: importBatch.fileName,
              createdAt: importBatch.createdAt,
              currency: bookAccount.currency,
            })
            .from(importBatch)
            .innerJoin(bookAccount, eq(bookAccount.id, importBatch.accountId))
            .where(and(eq(importBatch.id, id), eq(importBatch.bookId, bookId)));
          if (!batch) {
            throw new HTTPException(404, { message: "Batch not found" });
          }
          // The outer column is written out: Drizzle leaves the table off in a single-table query,
          // which would read as the subquery's own column.
          const seenBefore = sql<boolean>`exists (
            select 1 from import_line other
            join import_batch earlier on earlier.id = other.batch_id
            where other.book_id = ${bookId}
              and other.fingerprint = import_line.fingerprint
              and earlier.account_id = ${batch.accountId}
              and (earlier.created_at, earlier.id) < (${batch.createdAt.toISOString()}::timestamptz, ${batch.id}::uuid)
          )`;
          const lines = await tx
            .select({
              id: importLine.id,
              row: importLine.row,
              date: importLine.date,
              valueDate: importLine.valueDate,
              amount: importLine.amount,
              label: importLine.label,
              counterparty: importLine.counterparty,
              memo: importLine.memo,
              reference: importLine.reference,
              bankCategory: importLine.bankCategory,
              balance: importLine.balance,
              status: importLine.status,
              duplicate: seenBefore,
            })
            .from(importLine)
            .where(eq(importLine.batchId, id))
            .orderBy(desc(importLine.date), asc(importLine.row));
          return { batch, lines };
        });
        const text = (minor: bigint) => toDecimalString(money(minor, result.batch.currency));
        return c.json({
          id: result.batch.id,
          accountId: result.batch.accountId,
          preset: result.batch.preset,
          fileName: result.batch.fileName,
          createdAt: result.batch.createdAt.toISOString(),
          currency: result.batch.currency,
          lines: result.lines.map((l) => ({
            ...l,
            amount: text(l.amount),
            balance: l.balance === null ? null : text(l.balance),
          })),
        });
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

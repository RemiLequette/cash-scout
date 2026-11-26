import { zValidator } from "@hono/zod-validator";
import {
  budgetBatchSchema,
  budgetQuerySchema,
  categoryBudgetInputSchema,
  categoryBudgetUpdateSchema,
  money,
  parseAmount,
  resolveRate,
  settlementSchema,
  toDecimalString,
  type CategoryBudgetInput,
} from "@cash-scout/domain";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { withUser, type Db, type Tx } from "../db/client.js";
import {
  book,
  bookAccount,
  budgetSettlement,
  category,
  categoryBudget,
  nature,
} from "../db/schema.js";
import type { AppEnv } from "../http.js";
import { checked, idOf, missing, requireRole, rowOf } from "./access.js";
import { budgetColumns, loadYear, monthEnds } from "./budget-months.js";

type BudgetRow = Omit<typeof categoryBudget.$inferSelect, "bookId" | "createdAt" | "updatedAt">;

async function bookCurrencyOf(tx: Tx, bookId: string): Promise<string> {
  const [row] = await tx.select({ currency: book.currency }).from(book).where(eq(book.id, bookId));
  if (!row) {
    throw new HTTPException(404, { message: "Book not found" });
  }
  return row.currency;
}

/** One row of a book's table, for an id that must exist and not be archived. */
async function usable<T extends { archivedAt: Date | null }>(rows: Promise<T[]>, what: string) {
  const [row] = await rows;
  if (!row) {
    throw new HTTPException(400, { message: `Unknown ${what}` });
  }
  if (row.archivedAt) {
    throw new HTTPException(400, { message: `The ${what} is archived` });
  }
  return row;
}

/**
 * The stored values of a budget, from a validated input: the references are
 * checked against the book, amounts parsed in the book currency, and the rate
 * resolved (1 when the account is in the book currency).
 */
async function budgetValues(tx: Tx, bookId: string, input: CategoryBudgetInput) {
  const [categoryRow] = await tx
    .select({ transfer: nature.transfer })
    .from(category)
    .innerJoin(nature, eq(nature.id, category.natureId))
    .where(and(eq(category.id, input.categoryId), eq(category.bookId, bookId)));
  if (!categoryRow) {
    throw new HTTPException(400, { message: "Unknown category" });
  }
  const bookCurrency = await bookCurrencyOf(tx, bookId);
  const months = input.months.map((m) => checked(() => parseAmount(m, bookCurrency)).minor);
  const budgeted = months.some((m) => m !== 0n);
  if (budgeted && categoryRow.transfer) {
    throw new HTTPException(400, { message: "A transfer category only has planned transfers" });
  }
  if (budgeted && !input.accountId) {
    throw new HTTPException(400, { message: "A budget needs an account" });
  }
  let exchangeRate: string | null = null;
  if (input.accountId) {
    const account = await usable(
      tx
        .select({ currency: bookAccount.currency, archivedAt: bookAccount.archivedAt })
        .from(bookAccount)
        .where(and(eq(bookAccount.id, input.accountId), eq(bookAccount.bookId, bookId))),
      "account",
    );
    exchangeRate = checked(() => resolveRate(account.currency, bookCurrency, input.exchangeRate));
  } else if (input.exchangeRate !== undefined) {
    throw new HTTPException(400, { message: "An exchange rate needs an account" });
  }
  return {
    categoryId: input.categoryId,
    year: input.year,
    assumptions: input.assumptions ?? "",
    months,
    accountId: input.accountId ?? null,
    exchangeRate,
  };
}

/**
 * A reconciled month is locked: its grid amount stays until the reconciling is
 * taken back. `months` is what the budget would hold, all zeros when removed.
 */
async function unlocked(
  tx: Tx,
  current: Pick<BudgetRow, "categoryId" | "year" | "months">,
  months: readonly bigint[],
) {
  const settled = await tx
    .select({ month: budgetSettlement.month })
    .from(budgetSettlement)
    .where(
      and(
        eq(budgetSettlement.categoryId, current.categoryId),
        eq(budgetSettlement.year, current.year),
      ),
    );
  if (settled.some(({ month }) => months[month - 1] !== current.months[month - 1])) {
    throw new HTTPException(400, {
      message: "A reconciled month cannot change: take the reconciliation back first",
    });
  }
}

const NO_MONTHS: readonly bigint[] = Array<bigint>(12).fill(0n);

/** A stored budget back to the input that would create it, to apply an update to. */
function inputOf(row: BudgetRow, bookCurrency: string): Record<string, unknown> {
  return {
    categoryId: row.categoryId,
    year: row.year,
    assumptions: row.assumptions,
    months: row.months.map((minor) => toDecimalString(money(minor, bookCurrency))),
    accountId: row.accountId ?? undefined,
    exchangeRate: row.exchangeRate ?? undefined,
  };
}

/**
 * The budgets of a book, mounted under /books/:bookId/budgets. What remains of
 * a month is computed on demand from the grid and the journal, so it is never
 * stale. Members read; editors and owners write.
 */
export function budgetsRoutes(db: Db) {
  return (
    new Hono<AppEnv>()
      // Category budgets of a year ----------------------------------------------
      .get("/", zValidator("query", budgetQuerySchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const { year } = c.req.valid("query");
        const result = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "viewer");
          const bookCurrency = await bookCurrencyOf(tx, bookId);
          const { rows, journal } = await loadYear(tx, bookId, bookCurrency, year);
          const text = (minor: bigint) => toDecimalString(money(minor, bookCurrency));
          const budgets = rows.map(({ months, ...row }) => ({
            ...row,
            months: months.map(text),
          }));
          // What the journal holds in every category, budgeted or not, month by month.
          const held = [...journal].map(([categoryId, months]) => ({
            categoryId,
            actual: months.actual.map(text),
            planned: months.planned.map(text),
            unplanned: months.unplanned.map(text),
          }));
          return { year, bookCurrency, budgets, journal: held };
        });
        return c.json(result);
      })
      // The budget lines of a year.
      .get("/month-ends", zValidator("query", budgetQuerySchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const { year } = c.req.valid("query");
        const lines = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "viewer");
          return monthEnds(tx, bookId, await bookCurrencyOf(tx, bookId), year);
        });
        return c.json(lines);
      })
      // Reconciles a month's budget line, or takes it back.
      .post("/settlements", zValidator("json", settlementSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const { categoryId, year, month, reconciled } = c.req.valid("json");
        await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const [budget] = await tx
            .select({ months: categoryBudget.months })
            .from(categoryBudget)
            .where(
              and(
                eq(categoryBudget.bookId, bookId),
                eq(categoryBudget.categoryId, categoryId),
                eq(categoryBudget.year, year),
              ),
            );
          if (reconciled && !budget?.months[month - 1]) {
            throw new HTTPException(400, { message: "No budget for this category and month" });
          }
          if (reconciled) {
            await tx
              .insert(budgetSettlement)
              .values({ bookId, categoryId, year, month })
              .onConflictDoNothing();
          } else {
            await tx
              .delete(budgetSettlement)
              .where(
                and(
                  eq(budgetSettlement.bookId, bookId),
                  eq(budgetSettlement.categoryId, categoryId),
                  eq(budgetSettlement.year, year),
                  eq(budgetSettlement.month, month),
                ),
              );
          }
        });
        return c.body(null, 204);
      })
      // Saves the budgets of a year at once, all or nothing: the preparation screen's save.
      .post("/batch", zValidator("json", budgetBatchSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const { year, save, remove = [], versions = {} } = c.req.valid("json");
        const result = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const existing = await tx
            .select({
              id: categoryBudget.id,
              categoryId: categoryBudget.categoryId,
              year: categoryBudget.year,
              months: categoryBudget.months,
              version: categoryBudget.version,
            })
            .from(categoryBudget)
            .where(and(eq(categoryBudget.bookId, bookId), eq(categoryBudget.year, year)));
          const byCategory = new Map(existing.map((row) => [row.categoryId, row]));
          // What the screen read must still be there: else someone else changed it.
          for (const categoryId of [...save.map((item) => item.categoryId), ...remove]) {
            const row = byCategory.get(categoryId);
            if (row?.version !== versions[categoryId]) {
              throw new HTTPException(409, {
                message: "A budget was changed or deleted by someone else: reload the year",
              });
            }
          }
          for (const item of save) {
            const values = await budgetValues(tx, bookId, item);
            const row = byCategory.get(item.categoryId);
            if (row) {
              await unlocked(tx, row, values.months);
              await tx.update(categoryBudget).set(values).where(eq(categoryBudget.id, row.id));
            } else {
              await tx.insert(categoryBudget).values({ bookId, ...values });
            }
          }
          for (const categoryId of remove) {
            const row = byCategory.get(categoryId);
            if (row) {
              await unlocked(tx, row, NO_MONTHS);
              await tx.delete(categoryBudget).where(eq(categoryBudget.id, row.id));
            }
          }
          return { saved: save.length, removed: remove.filter((id) => byCategory.has(id)).length };
        });
        return c.json(result);
      })
      .post("/", zValidator("json", categoryBudgetInputSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const input = c.req.valid("json");
        const row = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const values = await budgetValues(tx, bookId, input);
          const [created] = await tx
            .insert(categoryBudget)
            .values({ bookId, ...values })
            .returning(budgetColumns);
          return outBudget(created!, await bookCurrencyOf(tx, bookId));
        });
        return c.json(row, 201);
      })
      .patch("/:id", zValidator("json", categoryBudgetUpdateSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Budget");
        const { version, ...patch } = c.req.valid("json");
        const row = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const [current] = await tx
            .select(budgetColumns)
            .from(categoryBudget)
            .where(and(eq(categoryBudget.id, id), eq(categoryBudget.bookId, bookId)));
          if (!current) {
            throw new HTTPException(404, { message: "Budget not found" });
          }
          const bookCurrency = await bookCurrencyOf(tx, bookId);
          const merged: Record<string, unknown> = { ...inputOf(current, bookCurrency) };
          for (const [key, value] of Object.entries(patch)) {
            if (value !== undefined) merged[key] = value === null ? undefined : value;
          }
          // The stored rate belongs to the stored account: a new account needs its own.
          if (patch.accountId !== undefined && patch.accountId !== current.accountId) {
            if (patch.exchangeRate === undefined) merged.exchangeRate = undefined;
          }
          const parsed = categoryBudgetInputSchema.safeParse(merged);
          if (!parsed.success) {
            throw new HTTPException(400, {
              message: parsed.error.issues
                .map((i) => `${i.path.join(".")}: ${i.message}`)
                .join("; "),
            });
          }
          const values = await budgetValues(tx, bookId, parsed.data);
          await unlocked(tx, current, values.months);
          const [updated] = await tx
            .update(categoryBudget)
            .set(values)
            .where(rowOf(categoryBudget, bookId, id, version))
            .returning(budgetColumns);
          if (!updated) return missing("Budget", version);
          return outBudget(updated, bookCurrency);
        });
        return c.json(row);
      })
      .delete("/:id", async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Budget");
        await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const [current] = await tx
            .select(budgetColumns)
            .from(categoryBudget)
            .where(and(eq(categoryBudget.id, id), eq(categoryBudget.bookId, bookId)));
          if (current) await unlocked(tx, current, NO_MONTHS);
          const deleted = await tx
            .delete(categoryBudget)
            .where(and(eq(categoryBudget.id, id), eq(categoryBudget.bookId, bookId)))
            .returning({ id: categoryBudget.id });
          if (deleted.length === 0) {
            throw new HTTPException(404, { message: "Budget not found" });
          }
        });
        return c.body(null, 204);
      })
  );
}

/** A budget as JSON: the amounts as decimal text in the book currency. */
function outBudget(row: BudgetRow, bookCurrency: string) {
  return {
    ...row,
    months: row.months.map((minor) => toDecimalString(money(minor, bookCurrency))),
  };
}

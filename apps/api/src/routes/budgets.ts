import { zValidator } from "@hono/zod-validator";
import {
  budgetBatchSchema,
  budgetQuerySchema,
  categoryBudgetInputSchema,
  categoryBudgetUpdateSchema,
  checkNames,
  money,
  parseAmount,
  profileInputSchema,
  profileUpdateSchema,
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
  budgetProfile,
  budgetSettlement,
  category,
  categoryBudget,
} from "../db/schema.js";
import type { AppEnv } from "../http.js";
import { checked, idOf, languagesOf, missing, requireRole, rowOf } from "./access.js";
import { budgetColumns, consumptionSign, loadYear, monthEnds, monthsOf } from "./budget-months.js";

const profileColumns = {
  version: budgetProfile.version,
  id: budgetProfile.id,
  names: budgetProfile.names,
  weights: budgetProfile.weights,
  archivedAt: budgetProfile.archivedAt,
};
const outProfile = <T extends { archivedAt: Date | null }>({ archivedAt, ...rest }: T) => ({
  ...rest,
  archived: archivedAt !== null,
});

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

/** Fails with 400 when the names do not fit the book's languages. */
async function validNames(tx: Tx, bookId: string, names: Record<string, string>) {
  const { languages, defaultLanguage } = await languagesOf(tx, bookId);
  const problem = checkNames(names, languages, defaultLanguage);
  if (problem) {
    throw new HTTPException(400, { message: problem });
  }
  return names;
}

/**
 * The stored values of a budget, from a validated input: the references are
 * checked against the book, amounts parsed in the book currency, and the rate
 * resolved (1 when the account is in the book currency).
 */
async function budgetValues(tx: Tx, bookId: string, input: CategoryBudgetInput) {
  const [categoryRow] = await tx
    .select({ id: category.id })
    .from(category)
    .where(and(eq(category.id, input.categoryId), eq(category.bookId, bookId)));
  if (!categoryRow) {
    throw new HTTPException(400, { message: "Unknown category" });
  }
  if (input.type === "scheduled") {
    return {
      categoryId: input.categoryId,
      year: input.year,
      type: input.type,
      assumptions: input.assumptions ?? "",
      amount: null,
      profileId: null,
      consumption: null,
      accountId: null,
      exchangeRate: null,
    };
  }
  const bookCurrency = await bookCurrencyOf(tx, bookId);
  const amount = checked(() => parseAmount(input.amount!, bookCurrency)).minor;
  await usable(
    tx
      .select({ archivedAt: budgetProfile.archivedAt })
      .from(budgetProfile)
      .where(and(eq(budgetProfile.id, input.profileId!), eq(budgetProfile.bookId, bookId))),
    "profile",
  );
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
  }
  return {
    categoryId: input.categoryId,
    year: input.year,
    type: input.type,
    assumptions: input.assumptions ?? "",
    amount,
    profileId: input.profileId!,
    consumption: input.consumption!,
    accountId: input.accountId ?? null,
    exchangeRate,
  };
}

/** A stored budget back to the input that would create it, to apply an update to. */
function inputOf(row: BudgetRow, bookCurrency: string): Record<string, unknown> {
  const text = (minor: bigint | null) =>
    minor === null ? undefined : toDecimalString(money(minor, bookCurrency));
  return {
    categoryId: row.categoryId,
    year: row.year,
    type: row.type,
    assumptions: row.assumptions,
    amount: text(row.amount),
    profileId: row.profileId ?? undefined,
    consumption: row.consumption ?? undefined,
    accountId: row.accountId ?? undefined,
    exchangeRate: row.exchangeRate ?? undefined,
  };
}

/**
 * The budgets of a book, mounted under /books/:bookId/budgets. Allocation,
 * consumption and what remains are computed on demand from the budget and the
 * journal, so they are never stale. Members read; editors and owners write.
 */
export function budgetsRoutes(db: Db) {
  return (
    new Hono<AppEnv>()
      // Profiles ---------------------------------------------------------------
      .get("/profiles", async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const rows = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "viewer");
          return tx
            .select(profileColumns)
            .from(budgetProfile)
            .where(eq(budgetProfile.bookId, bookId));
        });
        return c.json(rows.map(outProfile));
      })
      .post("/profiles", zValidator("json", profileInputSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const input = c.req.valid("json");
        const row = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const names = await validNames(tx, bookId, input.names);
          const [created] = await tx
            .insert(budgetProfile)
            .values({ bookId, names, weights: input.weights })
            .returning(profileColumns);
          return created!;
        });
        return c.json(outProfile(row), 201);
      })
      .patch("/profiles/:id", zValidator("json", profileUpdateSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Profile");
        const { names, weights, archived, version } = c.req.valid("json");
        const row = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const [updated] = await tx
            .update(budgetProfile)
            .set({
              ...(names && { names: await validNames(tx, bookId, names) }),
              ...(weights && { weights }),
              ...(archived !== undefined && { archivedAt: archived ? new Date() : null }),
            })
            .where(rowOf(budgetProfile, bookId, id, version))
            .returning(profileColumns);
          if (!updated) return missing("Profile", version);
          return updated;
        });
        return c.json(outProfile(row));
      })
      // A profile still used by a budget is refused by its foreign key: archive it.
      .delete("/profiles/:id", async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const id = idOf(c.req.param("id"), "Profile");
        await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const deleted = await tx
            .delete(budgetProfile)
            .where(and(eq(budgetProfile.id, id), eq(budgetProfile.bookId, bookId)))
            .returning({ id: budgetProfile.id });
          if (deleted.length === 0) {
            throw new HTTPException(404, { message: "Profile not found" });
          }
        });
        return c.body(null, 204);
      })

      // Category budgets of a year ----------------------------------------------
      .get("/", zValidator("query", budgetQuerySchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const { year } = c.req.valid("query");
        const result = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "viewer");
          const bookCurrency = await bookCurrencyOf(tx, bookId);
          const { rows, profiles, consumption } = await loadYear(tx, bookId, year);
          const weightsOf = new Map(profiles.map((p) => [p.id, p.weights]));
          const text = (minor: bigint) => toDecimalString(money(minor, bookCurrency));
          const budgets = rows.map(({ code, sign, ...row }) => {
            const base = {
              ...row,
              code,
              amount: row.amount === null ? null : text(row.amount),
            };
            if (row.type !== "periodic") return { ...base, months: null };
            // What the category's entries hold, read with its nature's sign, uses the budget.
            const months = monthsOf(row, sign, weightsOf, consumption);
            return {
              ...base,
              months: months.map((m) => ({
                allocated: text(m.allocated),
                available: text(m.available),
                consumed: text(m.consumed),
                remaining: text(m.remaining),
              })),
            };
          });
          // What the journal holds for the year in every category, budgeted or not, with the
          // sign of the category's nature.
          const totals = new Map<string, bigint>();
          for (const entry of consumption) {
            totals.set(
              entry.categoryId,
              (totals.get(entry.categoryId) ?? 0n) + consumptionSign(entry.sign) * entry.total,
            );
          }
          const actuals = [...totals].map(([categoryId, total]) => ({
            categoryId,
            total: text(total),
          }));
          return { year, bookCurrency, budgets, actuals };
        });
        return c.json(result);
      })
      // The month-end lines of a year: the unused budget of its periodic categories.
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
      // Settles ("reconciles") a month's unused budget, or takes the settling back.
      .post("/settlements", zValidator("json", settlementSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = idOf(c.req.param("bookId"));
        const { categoryId, year, month, reconciled } = c.req.valid("json");
        await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "editor");
          const [budget] = await tx
            .select({ type: categoryBudget.type })
            .from(categoryBudget)
            .where(
              and(
                eq(categoryBudget.bookId, bookId),
                eq(categoryBudget.categoryId, categoryId),
                eq(categoryBudget.year, year),
              ),
            );
          if (budget?.type !== "periodic") {
            throw new HTTPException(400, {
              message: "No periodic budget for this category and year",
            });
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
              await tx.update(categoryBudget).set(values).where(eq(categoryBudget.id, row.id));
            } else {
              await tx.insert(categoryBudget).values({ bookId, ...values });
            }
          }
          for (const categoryId of remove) {
            const row = byCategory.get(categoryId);
            if (row) await tx.delete(categoryBudget).where(eq(categoryBudget.id, row.id));
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
          // Dropping to a scheduled budget drops the periodic plan, account included.
          if (patch.type === "scheduled") {
            for (const key of ["amount", "profileId", "consumption", "accountId", "exchangeRate"]) {
              merged[key] = undefined;
            }
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

/** A budget as JSON: the amount as decimal text in the book currency. */
function outBudget(row: BudgetRow, bookCurrency: string) {
  return {
    ...row,
    amount: row.amount === null ? null : toDecimalString(money(row.amount, bookCurrency)),
  };
}

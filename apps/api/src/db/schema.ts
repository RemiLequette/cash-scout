import type { Names } from "@cash-scout/domain";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/**
 * Revision counter of a row, raised by every update. A client that read version
 * N sends it back with its change, which is refused (409) if the row moved on.
 */
const version = () =>
  integer("version")
    .notNull()
    .default(1)
    .$onUpdate(() => sql`version + 1`);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// ---------------------------------------------------------------------------
// Authentication (better-auth core tables and admin plugin fields).
// Not book data: no row-level security.
// ---------------------------------------------------------------------------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  /** "admin" for the super user, "user" otherwise. */
  role: text("role"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires", { withTimezone: true }),
  ...timestamps,
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonated_by"),
    ...timestamps,
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// Books (see README, Books). Protected by row-level security: a request sees
// only the books its user is a member of (see migrations, rls).
// ---------------------------------------------------------------------------

export const bookRole = pgEnum("book_role", ["owner", "editor", "viewer"]);
export type BookRole = (typeof bookRole.enumValues)[number];

export const book = pgTable("book", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /** ISO 4217 code of the book currency. */
  currency: char("currency", { length: 3 }).notNull(),
  /** Default language of the book's reference data (BCP 47). */
  defaultLanguage: text("default_language").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  version: version(),
});

export const bookMember = pgTable(
  "book_member",
  {
    bookId: uuid("book_id")
      .notNull()
      .references(() => book.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: bookRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.bookId, t.userId] }),
    index("book_member_user_idx").on(t.userId),
  ],
);

export const bookLanguage = pgTable(
  "book_language",
  {
    bookId: uuid("book_id")
      .notNull()
      .references(() => book.id, { onDelete: "cascade" }),
    /** BCP 47 tag of a language of the book's reference data. */
    language: text("language").notNull(),
  },
  (t) => [primaryKey({ columns: [t.bookId, t.language] })],
);

// ---------------------------------------------------------------------------
// Reference data (see README, Reference data). Every item belongs to one book
// and its parent must belong to the same book (composite foreign keys).
// Names are stored per language in `names`: { "fr": "...", "en": "..." }.
// ---------------------------------------------------------------------------

const bookId = () =>
  uuid("book_id")
    .notNull()
    .references(() => book.id, { onDelete: "cascade" });
const names = () => jsonb("names").$type<Names>().notNull();
const archivedAt = () => timestamp("archived_at", { withTimezone: true });

export const categoryGroup = pgTable(
  "category_group",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: bookId(),
    names: names(),
    /** Display order of the groups among those of the same parent. */
    position: integer("position").notNull().default(0),
    /** The group this one is part of, if any: groups nest, to any depth. */
    parentId: uuid("parent_id"),
    /** A palette colour name ("blue", "teal"…) for the dashboard; inherited from the parent when null. */
    color: text("color"),
    archivedAt: archivedAt(),
    version: version(),
  },
  (t) => [
    unique().on(t.id, t.bookId),
    index("category_group_book_idx").on(t.bookId),
    foreignKey({
      columns: [t.parentId, t.bookId],
      foreignColumns: [t.id, t.bookId],
    }),
  ],
);

/**
 * A nature of the book's flows (Income, Spending, Exceptional…). Its sign sets
 * how its amounts read (dashboard, budgets); a transfer nature holds the
 * movements between the book's own accounts. Natures and balances share one
 * display order (`position`).
 */
export const nature = pgTable(
  "nature",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: bookId(),
    names: names(),
    /** 1 shows amounts as entered, -1 reverses them (spending reads as positive). */
    sign: smallint("sign").$type<1 | -1>().notNull(),
    /** Movements between the book's accounts: out of the dashboard, used by transfers. */
    transfer: boolean("transfer").notNull().default(false),
    position: integer("position").notNull().default(0),
    archivedAt: archivedAt(),
    version: version(),
  },
  (t) => [
    unique().on(t.id, t.bookId),
    index("nature_book_idx").on(t.bookId),
    check("nature_sign_check", sql`${t.sign} IN (1, -1)`),
  ],
);

/** An analytic balance: the sum of several natures, placed in the same list as the natures. */
export const balance = pgTable(
  "balance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: bookId(),
    names: names(),
    position: integer("position").notNull().default(0),
    archivedAt: archivedAt(),
    version: version(),
  },
  (t) => [unique().on(t.id, t.bookId), index("balance_book_idx").on(t.bookId)],
);

export const balanceNature = pgTable(
  "balance_nature",
  {
    bookId: bookId(),
    balanceId: uuid("balance_id").notNull(),
    natureId: uuid("nature_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.balanceId, t.natureId] }),
    foreignKey({
      columns: [t.balanceId, t.bookId],
      foreignColumns: [balance.id, balance.bookId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.natureId, t.bookId],
      foreignColumns: [nature.id, nature.bookId],
    }),
  ],
);

export const category = pgTable(
  "category",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: bookId(),
    groupId: uuid("group_id").notNull(),
    /** Short code setting the sort order, unique in the book. */
    code: text("code").notNull(),
    natureId: uuid("nature_id").notNull(),
    names: names(),
    archivedAt: archivedAt(),
    version: version(),
  },
  (t) => [
    unique().on(t.id, t.bookId),
    unique("category_book_code_unique").on(t.bookId, t.code),
    foreignKey({
      columns: [t.groupId, t.bookId],
      foreignColumns: [categoryGroup.id, categoryGroup.bookId],
    }),
    foreignKey({
      columns: [t.natureId, t.bookId],
      foreignColumns: [nature.id, nature.bookId],
    }),
  ],
);

export const subCategory = pgTable(
  "sub_category",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: bookId(),
    categoryId: uuid("category_id").notNull(),
    names: names(),
    archivedAt: archivedAt(),
    version: version(),
  },
  (t) => [
    unique().on(t.id, t.bookId),
    foreignKey({
      columns: [t.categoryId, t.bookId],
      foreignColumns: [category.id, category.bookId],
    }),
  ],
);

/** A bank account of a book (not the sign-in `account` of better-auth). */
export const bookAccount = pgTable(
  "book_account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: bookId(),
    names: names(),
    /** ISO 4217 code: entries on the account are in this currency. */
    currency: char("currency", { length: 3 }).notNull(),
    /** Warn when the projected balance goes below this amount, in minor units. */
    lowBalanceThreshold: bigint("low_balance_threshold", { mode: "bigint" }),
    /**
     * What no entry explains of the balance, in minor units of the account currency.
     * Not dated and in no category: the balance is this plus the entries.
     */
    openingBalance: bigint("opening_balance", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    /** The opening balance in minor units of the book currency, at the rate given when it was set. */
    openingBookAmount: bigint("opening_book_amount", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    archivedAt: archivedAt(),
    version: version(),
  },
  (t) => [unique().on(t.id, t.bookId), index("book_account_book_idx").on(t.bookId)],
);

// ---------------------------------------------------------------------------
// Journal (see README, Journal). One entry per transaction, past or future.
// Year, month, category, group and nature are derived, never stored.
// ---------------------------------------------------------------------------

/**
 * A transfer between two accounts of a book: two journal entries, a source
 * (negative) and a destination (positive), that change together. The source
 * date is the transfer's date; the destination is credited `delayDays` later.
 */
export const transfer = pgTable(
  "transfer",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: bookId(),
    /** Days between the source entry and the destination entry. */
    delayDays: integer("delay_days").notNull().default(0),
    ...timestamps,
    version: version(),
  },
  (t) => [
    unique().on(t.id, t.bookId),
    index("transfer_book_idx").on(t.bookId),
    check("transfer_delay_check", sql`${t.delayDays} BETWEEN 0 AND 60`),
  ],
);

export const transferLeg = pgEnum("transfer_leg", ["source", "destination"]);

/**
 * A compensation: an amount that counts in two sub-categories without any money
 * moving. Two journal entries without an account, in the book currency, that
 * change together: `plus` receives the amount and `minus` its negation.
 */
export const compensation = pgTable(
  "compensation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: bookId(),
    ...timestamps,
    version: version(),
  },
  (t) => [unique().on(t.id, t.bookId), index("compensation_book_idx").on(t.bookId)],
);

export const compensationSide = pgEnum("compensation_side", ["plus", "minus"]);

/**
 * One bank movement counting in several sub-categories (see docs/splits.md):
 * journal entries, its parts, that share the account, date, month shift and
 * reconciled state. The bank amount is their sum and is not stored.
 */
export const split = pgTable(
  "split",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: bookId(),
    ...timestamps,
    version: version(),
  },
  (t) => [unique().on(t.id, t.bookId), index("split_book_idx").on(t.bookId)],
);

// ---------------------------------------------------------------------------
// Loans (see docs/wealth.md). Their schedule is computed from the terms and the
// events, never stored. Amounts are in the currency of the payment account.
// ---------------------------------------------------------------------------

export const loanInsurance = pgEnum("loan_insurance", ["none", "initial", "remaining"]);
export const loanPart = pgEnum("loan_part", ["payment", "insurance", "penalty"]);
export const loanDeferral = pgEnum("loan_deferral", ["none", "interest", "total"]);

export const loan = pgTable(
  "loan",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: bookId(),
    name: text("name").notNull(),
    lender: text("lender").notNull().default(""),
    /** Capital borrowed, in minor units. */
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    /** Yearly nominal rate, in percent. */
    rate: numeric("rate").notNull(),
    /** Number of monthly payments. */
    term: integer("term").notNull(),
    /** Date of the first payment. */
    start: date("start", { mode: "string" }).notNull(),
    insuranceMode: loanInsurance("insurance_mode").notNull().default("none"),
    insuranceRate: numeric("insurance_rate").notNull().default("0"),
    /** The insurance is its own entry, outside the payment's split. */
    insuranceSeparate: boolean("insurance_separate").notNull().default(false),
    /** Account of a separate insurance; none for the payment account. */
    insuranceAccountId: uuid("insurance_account_id"),
    /** Sub-category of the penalties of early repayments and buy-backs. */
    penaltySubCategoryId: uuid("penalty_sub_category_id"),
    deferralMode: loanDeferral("deferral_mode").notNull().default("none"),
    deferralMonths: integer("deferral_months").notNull().default(0),
    /** The account the payments are taken from. */
    accountId: uuid("account_id").notNull(),
    capitalSubCategoryId: uuid("capital_sub_category_id").notNull(),
    interestSubCategoryId: uuid("interest_sub_category_id").notNull(),
    insuranceSubCategoryId: uuid("insurance_sub_category_id"),
    ...timestamps,
    version: version(),
  },
  (t) => [
    unique().on(t.id, t.bookId),
    index("loan_book_idx").on(t.bookId),
    foreignKey({
      columns: [t.accountId, t.bookId],
      foreignColumns: [bookAccount.id, bookAccount.bookId],
    }),
    foreignKey({
      columns: [t.capitalSubCategoryId, t.bookId],
      foreignColumns: [subCategory.id, subCategory.bookId],
    }),
    foreignKey({
      columns: [t.interestSubCategoryId, t.bookId],
      foreignColumns: [subCategory.id, subCategory.bookId],
    }),
    foreignKey({
      columns: [t.insuranceSubCategoryId, t.bookId],
      foreignColumns: [subCategory.id, subCategory.bookId],
    }),
    foreignKey({
      columns: [t.insuranceAccountId, t.bookId],
      foreignColumns: [bookAccount.id, bookAccount.bookId],
    }),
    foreignKey({
      columns: [t.penaltySubCategoryId, t.bookId],
      foreignColumns: [subCategory.id, subCategory.bookId],
    }),
    check("loan_amount_check", sql`${t.amount} > 0`),
    check("loan_term_check", sql`${t.term} BETWEEN 1 AND 600`),
    check("loan_rate_check", sql`${t.rate} >= 0 AND ${t.insuranceRate} >= 0`),
    check(
      "loan_deferral_check",
      sql`${t.deferralMonths} >= 0 AND ${t.deferralMonths} < ${t.term} AND (${t.deferralMode} = 'none') = (${t.deferralMonths} = 0)`,
    ),
    check(
      "loan_insurance_check",
      sql`${t.insuranceMode} = 'none' OR ${t.insuranceSubCategoryId} IS NOT NULL`,
    ),
  ],
);

export const loanEventKind = pgEnum("loan_event_kind", [
  "drawdown",
  "repayment",
  "buyback",
  "insurance",
]);
export const loanRepaymentKeeps = pgEnum("loan_repayment_keeps", ["payment", "term"]);

/** A dated event that changes a loan's schedule from its date. */
export const loanEvent = pgTable(
  "loan_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: bookId(),
    loanId: uuid("loan_id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    kind: loanEventKind("kind").notNull(),
    /** Capital released or repaid, in minor units; none repays all that is left. */
    amount: bigint("amount", { mode: "bigint" }),
    /** What a partial repayment leaves as it was: the payment or the term. */
    keeps: loanRepaymentKeeps("keeps").notNull().default("payment"),
    /** For a change of insurer: the insurance from the date on. */
    insuranceMode: loanInsurance("insurance_mode"),
    insuranceRate: numeric("insurance_rate"),
    insuranceSeparate: boolean("insurance_separate").notNull().default(false),
    insuranceAccountId: uuid("insurance_account_id"),
    /** Paid with an early repayment or a buy-back, on top of the capital, in minor units. */
    penalty: bigint("penalty", { mode: "bigint" }),
    /** A comment on the event. */
    note: text("note").notNull().default(""),
    ...timestamps,
    version: version(),
  },
  (t) => [
    unique().on(t.id, t.bookId),
    index("loan_event_loan_idx").on(t.loanId),
    foreignKey({
      columns: [t.loanId, t.bookId],
      foreignColumns: [loan.id, loan.bookId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.insuranceAccountId, t.bookId],
      foreignColumns: [bookAccount.id, bookAccount.bookId],
    }),
    check("loan_event_amount_check", sql`${t.amount} IS NULL OR ${t.amount} > 0`),
    check(
      "loan_event_penalty_check",
      sql`${t.penalty} IS NULL OR (${t.penalty} > 0 AND ${t.kind} IN ('repayment', 'buyback'))`,
    ),
    check(
      "loan_event_kind_check",
      sql`(${t.kind} <> 'drawdown' OR ${t.amount} IS NOT NULL) AND (${t.kind} NOT IN ('buyback', 'insurance') OR ${t.amount} IS NULL) AND ((${t.kind} = 'insurance') = (${t.insuranceMode} IS NOT NULL AND ${t.insuranceRate} IS NOT NULL))`,
    ),
  ],
);

export const journalEntry = pgTable(
  "journal_entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: bookId(),
    date: date("date", { mode: "string" }).notNull(),
    /** None for a side of a compensation, which is then in the book currency. */
    accountId: uuid("account_id"),
    subCategoryId: uuid("sub_category_id").notNull(),
    description: text("description").notNull().default(""),
    /** Signed, in minor units of the account currency, as entered. */
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    /** The amount when the entry was created; never changed. Variance = amount − planned. */
    plannedAmount: bigint("planned_amount", { mode: "bigint" }).notNull(),
    /** 1 unit of the account currency = rate units of the book currency, fixed when saved. */
    exchangeRate: numeric("exchange_rate").notNull(),
    /** The amount in minor units of the book currency, at the exchange rate. */
    bookAmount: bigint("book_amount", { mode: "bigint" }).notNull(),
    /** For information only: the amount and currency actually paid. */
    originalAmount: bigint("original_amount", { mode: "bigint" }),
    originalCurrency: char("original_currency", { length: 3 }),
    /** Matched with the bank statement; an unreconciled entry is a forecast. */
    reconciled: boolean("reconciled").notNull().default(false),
    /** Counts in the budget of the month before or after its date's. */
    monthShifted: boolean("month_shifted").notNull().default(false),
    /** Schedule that generated the entry (schedules come in a later version). */
    scheduleId: uuid("schedule_id"),
    /** The transfer this entry is one side of, and which side. */
    transferId: uuid("transfer_id"),
    transferLeg: transferLeg("transfer_leg"),
    /** The compensation this entry is one side of, and which side. */
    compensationId: uuid("compensation_id"),
    compensationSide: compensationSide("compensation_side"),
    /** The split this entry is a part of. */
    splitId: uuid("split_id"),
    /** The part of a split that takes what the others leave of the bank amount. */
    splitRemainder: boolean("split_remainder").notNull().default(false),
    /** The loan whose schedule planned the entry. */
    loanId: uuid("loan_id"),
    /** What the entry is of its loan: its payment, its insurance paid apart, or a penalty. */
    loanPart: loanPart("loan_part").notNull().default("payment"),
    /** The statement import that created the entry. */
    importBatchId: uuid("import_batch_id").references((): AnyPgColumn => importBatch.id, {
      onDelete: "set null",
    }),
    ...timestamps,
    version: version(),
  },
  (t) => [
    foreignKey({
      columns: [t.transferId, t.bookId],
      foreignColumns: [transfer.id, transfer.bookId],
    }).onDelete("cascade"),
    unique("journal_entry_transfer_leg_unique").on(t.transferId, t.transferLeg),
    check(
      "journal_entry_transfer_check",
      sql`(${t.transferId} IS NULL) = (${t.transferLeg} IS NULL)`,
    ),
    foreignKey({
      columns: [t.compensationId, t.bookId],
      foreignColumns: [compensation.id, compensation.bookId],
    }).onDelete("cascade"),
    unique("journal_entry_compensation_side_unique").on(t.compensationId, t.compensationSide),
    check(
      "journal_entry_compensation_check",
      sql`(${t.compensationId} IS NULL) = (${t.compensationSide} IS NULL)`,
    ),
    check(
      "journal_entry_account_check",
      sql`(${t.accountId} IS NULL) = (${t.compensationId} IS NOT NULL)`,
    ),
    foreignKey({
      columns: [t.splitId, t.bookId],
      foreignColumns: [split.id, split.bookId],
    }).onDelete("cascade"),
    uniqueIndex("journal_entry_split_remainder_unique")
      .on(t.splitId)
      .where(sql`${t.splitRemainder}`),
    check(
      "journal_entry_split_check",
      sql`(${t.splitId} IS NOT NULL OR NOT ${t.splitRemainder}) AND (${t.splitId} IS NULL OR (${t.transferId} IS NULL AND ${t.compensationId} IS NULL))`,
    ),
    index("journal_entry_split_idx").on(t.splitId),
    foreignKey({
      columns: [t.loanId, t.bookId],
      foreignColumns: [loan.id, loan.bookId],
    }),
    index("journal_entry_loan_idx").on(t.loanId),
    check("journal_entry_loan_check", sql`${t.loanId} IS NOT NULL OR ${t.loanPart} = 'payment'`),
    foreignKey({
      columns: [t.accountId, t.bookId],
      foreignColumns: [bookAccount.id, bookAccount.bookId],
    }),
    foreignKey({
      columns: [t.subCategoryId, t.bookId],
      foreignColumns: [subCategory.id, subCategory.bookId],
    }),
    check(
      "journal_entry_original_check",
      sql`(${t.originalAmount} IS NULL) = (${t.originalCurrency} IS NULL)`,
    ),
    check("journal_entry_rate_check", sql`${t.exchangeRate} > 0`),
    index("journal_entry_book_date_idx").on(t.bookId, t.date),
    index("journal_entry_account_idx").on(t.accountId),
    index("journal_entry_sub_category_idx").on(t.subCategoryId),
  ],
);

// ---------------------------------------------------------------------------
// Bank statement import (see docs/bank-import.md). A statement file becomes an
// import batch: its lines are kept, reviewed over several sittings, then imported.
// ---------------------------------------------------------------------------

export const ruleDirection = pgEnum("rule_direction", ["any", "in", "out"]);

/**
 * What to do with the statement lines that fit its conditions; rules are tried
 * in `position` order and the first that fits wins. They belong to the book.
 */
export const importRule = pgTable(
  "import_rule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: bookId(),
    position: integer("position").notNull(),
    name: text("name").notNull(),
    /** Conditions: all that are set must hold. */
    text: text("text"),
    bankCategory: text("bank_category"),
    direction: ruleDirection("direction").notNull().default("any"),
    /** Bounds on the size of the amount, as decimal text in the account's currency. */
    minAmount: numeric("min_amount"),
    maxAmount: numeric("max_amount"),
    /** Actions. */
    subCategoryId: uuid("sub_category_id").references(() => subCategory.id, {
      onDelete: "set null",
    }),
    description: text("description"),
    ignore: boolean("ignore").notNull().default(false),
    ...timestamps,
    version: version(),
  },
  (t) => [unique().on(t.id, t.bookId), index("import_rule_book_idx").on(t.bookId, t.position)],
);

/** A statement file read for one account. */
export const importBatch = pgTable(
  "import_batch",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: bookId(),
    accountId: uuid("account_id").notNull(),
    /** The bank format the file was read with. */
    preset: text("preset").notNull(),
    fileName: text("file_name").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
    version: version(),
  },
  (t) => [
    unique().on(t.id, t.bookId),
    foreignKey({
      columns: [t.accountId, t.bookId],
      foreignColumns: [bookAccount.id, bookAccount.bookId],
    }),
    index("import_batch_book_idx").on(t.bookId),
    index("import_batch_account_idx").on(t.accountId),
  ],
);

export const importLineStatus = pgEnum("import_line_status", [
  "review",
  "validated",
  "ignored",
  "imported",
]);

/** One line of a statement, as read; nothing in it is matched with the book yet. */
export const importLine = pgTable(
  "import_line",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: bookId(),
    batchId: uuid("batch_id").notNull(),
    /** The line's number in the file, from 1. */
    row: integer("row").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    valueDate: date("value_date", { mode: "string" }),
    /** Signed, in minor units of the account currency. */
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    label: text("label").notNull().default(""),
    counterparty: text("counterparty").notNull().default(""),
    memo: text("memo").notNull().default(""),
    reference: text("reference").notNull().default(""),
    bankCategory: text("bank_category").notNull().default(""),
    /** The balance after the line (end of day for some banks), when the statement gives it. */
    balance: bigint("balance", { mode: "bigint" }),
    accountNumber: text("account_number").notNull().default(""),
    /** The cells of the source line. */
    raw: jsonb("raw").$type<string[]>().notNull(),
    /** Date, amount, normalised label and rank among identical lines: the same line in another file has the same one. */
    fingerprint: text("fingerprint").notNull(),
    status: importLineStatus("status").notNull().default("review"),
    /** Chosen in the review: the sub-category of the entry to create. */
    subCategoryId: uuid("sub_category_id").references(() => subCategory.id, {
      onDelete: "set null",
    }),
    /** The rule that proposed the sub-category, description or ignoring. */
    ruleId: uuid("rule_id").references(() => importRule.id, { onDelete: "set null" }),
    /** For a transfer to create: the other account (this one is the batch's). */
    transferAccountId: uuid("transfer_account_id").references(() => bookAccount.id, {
      onDelete: "set null",
    }),
    /** The description of the entry to create, when it was rewritten. */
    description: text("description"),
    /** The journal entry the line is: chosen in the review, or created by the import. */
    entryId: uuid("entry_id").references(() => journalEntry.id, { onDelete: "set null" }),
    /** For a line matched to an entry: the entry's date and reconciled flag before the import, to undo it. */
    previousDate: date("previous_date", { mode: "string" }),
    previousReconciled: boolean("previous_reconciled"),
    previousMonthShifted: boolean("previous_month_shifted"),
    /** The amount of a matched forecast before it took the bank's. */
    previousAmount: bigint("previous_amount", { mode: "bigint" }),
    ...timestamps,
    version: version(),
  },
  (t) => [
    foreignKey({
      columns: [t.batchId, t.bookId],
      foreignColumns: [importBatch.id, importBatch.bookId],
    }).onDelete("cascade"),
    index("import_line_batch_idx").on(t.batchId),
    index("import_line_entry_idx").on(t.entryId),
    index("import_line_fingerprint_idx").on(t.bookId, t.fingerprint),
  ],
);

// ---------------------------------------------------------------------------
// Budgets (see README, Budgets and cash projection).
// ---------------------------------------------------------------------------

/**
 * The grid of one category for one year: what is budgeted month by month
 * without saying which entries will spend it, and the account it is expected
 * to be spent from. Planned entries are budgeted on top, in the journal.
 */
export const categoryBudget = pgTable(
  "category_budget",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: bookId(),
    categoryId: uuid("category_id").notNull(),
    year: integer("year").notNull(),
    assumptions: text("assumptions").notNull().default(""),
    /**
     * The grid: 12 monthly amounts in minor units of the book currency, read
     * with the sign of the category's nature.
     */
    months: bigint("months", { mode: "bigint" })
      .array()
      .notNull()
      .default(sql`array_fill(0::bigint, ARRAY[12])`),
    /** Account of the budget lines; the API requires it when a month is not zero. */
    accountId: uuid("account_id"),
    /** 1 unit of the account currency = rate units of the book currency, as for entries. */
    exchangeRate: numeric("exchange_rate"),
    ...timestamps,
    version: version(),
  },
  (t) => [
    unique("category_budget_year_unique").on(t.categoryId, t.year),
    foreignKey({
      columns: [t.categoryId, t.bookId],
      foreignColumns: [category.id, category.bookId],
    }),
    foreignKey({
      columns: [t.accountId, t.bookId],
      foreignColumns: [bookAccount.id, bookAccount.bookId],
    }),
    index("category_budget_book_year_idx").on(t.bookId, t.year),
    check("category_budget_months_check", sql`cardinality(${t.months}) = 12`),
    check(
      "category_budget_rate_check",
      sql`(${t.accountId} IS NULL) = (${t.exchangeRate} IS NULL) AND (${t.exchangeRate} IS NULL OR ${t.exchangeRate} > 0)`,
    ),
  ],
);

/**
 * A reconciled month of a category's budget: its budget line then goes to 0.
 * The line itself is never stored: it is computed from the grid and the
 * journal, so only the reconciling is.
 */
export const budgetSettlement = pgTable(
  "budget_settlement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: bookId(),
    categoryId: uuid("category_id").notNull(),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("budget_settlement_month_unique").on(t.categoryId, t.year, t.month),
    foreignKey({
      columns: [t.categoryId, t.bookId],
      foreignColumns: [category.id, category.bookId],
    }),
    index("budget_settlement_book_year_idx").on(t.bookId, t.year),
    check("budget_settlement_month_check", sql`${t.month} BETWEEN 1 AND 12`),
  ],
);

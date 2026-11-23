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
  text,
  timestamp,
  unique,
  uuid,
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

export const direction = pgEnum("direction", ["expense", "income", "saving", "transfer"]);
export const accountKind = pgEnum("account_kind", ["bank", "virtual"]);
export const budgetType = pgEnum("budget_type", ["scheduled", "periodic"]);
export const consumptionMode = pgEnum("consumption_mode", ["lapse", "roll_over", "annual_pool"]);

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
    /** Display order of the groups. */
    position: integer("position").notNull().default(0),
    archivedAt: archivedAt(),
    version: version(),
  },
  (t) => [unique().on(t.id, t.bookId), index("category_group_book_idx").on(t.bookId)],
);

export const category = pgTable(
  "category",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: bookId(),
    groupId: uuid("group_id").notNull(),
    /** Short code setting the sort order, unique in the book. */
    code: text("code").notNull(),
    direction: direction("direction").notNull(),
    /** Budget type given to the category in a year not yet budgeted. */
    defaultBudgetType: budgetType("default_budget_type").notNull().default("periodic"),
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

export const paymentType = pgTable(
  "payment_type",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: bookId(),
    names: names(),
    archivedAt: archivedAt(),
    version: version(),
  },
  (t) => [unique().on(t.id, t.bookId), index("payment_type_book_idx").on(t.bookId)],
);

/** A bank or virtual account of a book (not the sign-in `account` of better-auth). */
export const bookAccount = pgTable(
  "book_account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: bookId(),
    names: names(),
    /** Bank accounts are reconciled and projected; virtual ones hold zero-sum compensations. */
    kind: accountKind("kind").notNull(),
    /** ISO 4217 code: entries on the account are in this currency. */
    currency: char("currency", { length: 3 }).notNull(),
    /** Warn when the projected balance goes below this amount, in minor units. */
    lowBalanceThreshold: bigint("low_balance_threshold", { mode: "bigint" }),
    archivedAt: archivedAt(),
    version: version(),
  },
  (t) => [unique().on(t.id, t.bookId), index("book_account_book_idx").on(t.bookId)],
);

// ---------------------------------------------------------------------------
// Journal (see README, Journal). One entry per transaction, past or future.
// Year, month, category, group and direction are derived, never stored.
// ---------------------------------------------------------------------------

export const journalEntry = pgTable(
  "journal_entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: bookId(),
    date: date("date", { mode: "string" }).notNull(),
    accountId: uuid("account_id").notNull(),
    subCategoryId: uuid("sub_category_id").notNull(),
    description: text("description").notNull().default(""),
    paymentTypeId: uuid("payment_type_id"),
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
    /** Schedule that generated the entry (schedules come in a later version). */
    scheduleId: uuid("schedule_id"),
    /** Matching entry in another book (linked entries come in a later version). */
    linkId: uuid("link_id"),
    ...timestamps,
    version: version(),
  },
  (t) => [
    foreignKey({
      columns: [t.accountId, t.bookId],
      foreignColumns: [bookAccount.id, bookAccount.bookId],
    }),
    foreignKey({
      columns: [t.subCategoryId, t.bookId],
      foreignColumns: [subCategory.id, subCategory.bookId],
    }),
    foreignKey({
      columns: [t.paymentTypeId, t.bookId],
      foreignColumns: [paymentType.id, paymentType.bookId],
    }),
    check(
      "journal_entry_original_check",
      sql`(${t.originalAmount} IS NULL) = (${t.originalCurrency} IS NULL)`,
    ),
    check("journal_entry_rate_check", sql`${t.exchangeRate} > 0`),
    index("journal_entry_book_date_idx").on(t.bookId, t.date),
    index("journal_entry_account_idx").on(t.accountId),
    index("journal_entry_sub_category_idx").on(t.subCategoryId),
    index("journal_entry_payment_type_idx").on(t.paymentTypeId),
  ],
);

// ---------------------------------------------------------------------------
// Budgets (see README, Budgets and cash projection).
// ---------------------------------------------------------------------------

/** 12 monthly weights in basis points (10 000 = 100 %), shared by the book's categories. */
export const budgetProfile = pgTable(
  "budget_profile",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: bookId(),
    names: names(),
    weights: integer("weights").array().notNull(),
    archivedAt: archivedAt(),
    version: version(),
  },
  (t) => [
    unique().on(t.id, t.bookId),
    index("budget_profile_book_idx").on(t.bookId),
    check(
      "budget_profile_weights_check",
      sql`cardinality(${t.weights}) = 12
        AND array_position(${t.weights}, NULL) IS NULL
        AND 0 <= ALL(${t.weights})
        AND ${t.weights}[1] + ${t.weights}[2] + ${t.weights}[3] + ${t.weights}[4]
          + ${t.weights}[5] + ${t.weights}[6] + ${t.weights}[7] + ${t.weights}[8]
          + ${t.weights}[9] + ${t.weights}[10] + ${t.weights}[11] + ${t.weights}[12] = 10000`,
    ),
  ],
);

/**
 * The plan of one category for one year. A scheduled budget only holds the
 * type and the assumptions (its plan is future journal entries); a periodic one
 * also holds the annual amount, how it is spread and consumed, and where it
 * is expected to be spent.
 */
export const categoryBudget = pgTable(
  "category_budget",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: bookId(),
    categoryId: uuid("category_id").notNull(),
    year: integer("year").notNull(),
    type: budgetType("type").notNull(),
    assumptions: text("assumptions").notNull().default(""),
    /** Annual amount in minor units of the book currency, positive (periodic). */
    amount: bigint("amount", { mode: "bigint" }),
    profileId: uuid("profile_id"),
    consumption: consumptionMode("consumption"),
    /** Account where the remaining budget is expected to be spent (periodic). */
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
      columns: [t.profileId, t.bookId],
      foreignColumns: [budgetProfile.id, budgetProfile.bookId],
    }),
    foreignKey({
      columns: [t.accountId, t.bookId],
      foreignColumns: [bookAccount.id, bookAccount.bookId],
    }),
    index("category_budget_book_year_idx").on(t.bookId, t.year),
    check(
      "category_budget_type_check",
      sql`(${t.type} = 'periodic' AND ${t.amount} IS NOT NULL AND ${t.profileId} IS NOT NULL
          AND ${t.consumption} IS NOT NULL)
        OR (${t.type} = 'scheduled' AND ${t.amount} IS NULL AND ${t.profileId} IS NULL
          AND ${t.consumption} IS NULL AND ${t.accountId} IS NULL)`,
    ),
    check(
      "category_budget_rate_check",
      sql`(${t.accountId} IS NULL) = (${t.exchangeRate} IS NULL) AND (${t.exchangeRate} IS NULL OR ${t.exchangeRate} > 0)`,
    ),
  ],
);

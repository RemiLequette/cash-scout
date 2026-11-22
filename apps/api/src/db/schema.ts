import type { Names } from "@cash-scout/domain";
import {
  bigint,
  boolean,
  char,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

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

export const direction = pgEnum("direction", ["expense", "income", "transfer"]);
export const accountKind = pgEnum("account_kind", ["bank", "virtual"]);

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
    names: names(),
    archivedAt: archivedAt(),
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
  },
  (t) => [unique().on(t.id, t.bookId), index("book_account_book_idx").on(t.bookId)],
);

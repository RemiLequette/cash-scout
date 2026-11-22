CREATE TYPE "public"."account_kind" AS ENUM('bank', 'virtual');--> statement-breakpoint
CREATE TYPE "public"."direction" AS ENUM('expense', 'income', 'transfer');--> statement-breakpoint
CREATE TABLE "book_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"names" jsonb NOT NULL,
	"kind" "account_kind" NOT NULL,
	"currency" char(3) NOT NULL,
	"low_balance_threshold" bigint,
	"archived_at" timestamp with time zone,
	CONSTRAINT "book_account_id_book_id_unique" UNIQUE("id","book_id")
);
--> statement-breakpoint
CREATE TABLE "book_language" (
	"book_id" uuid NOT NULL,
	"language" text NOT NULL,
	CONSTRAINT "book_language_book_id_language_pk" PRIMARY KEY("book_id","language")
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"code" text NOT NULL,
	"direction" "direction" NOT NULL,
	"names" jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "category_id_book_id_unique" UNIQUE("id","book_id"),
	CONSTRAINT "category_book_code_unique" UNIQUE("book_id","code")
);
--> statement-breakpoint
CREATE TABLE "category_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"names" jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "category_group_id_book_id_unique" UNIQUE("id","book_id")
);
--> statement-breakpoint
CREATE TABLE "payment_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"names" jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "payment_type_id_book_id_unique" UNIQUE("id","book_id")
);
--> statement-breakpoint
CREATE TABLE "sub_category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"names" jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "sub_category_id_book_id_unique" UNIQUE("id","book_id")
);
--> statement-breakpoint
ALTER TABLE "book_account" ADD CONSTRAINT "book_account_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_language" ADD CONSTRAINT "book_language_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_group_id_book_id_category_group_id_book_id_fk" FOREIGN KEY ("group_id","book_id") REFERENCES "public"."category_group"("id","book_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_group" ADD CONSTRAINT "category_group_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_type" ADD CONSTRAINT "payment_type_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_category" ADD CONSTRAINT "sub_category_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_category" ADD CONSTRAINT "sub_category_category_id_book_id_category_id_book_id_fk" FOREIGN KEY ("category_id","book_id") REFERENCES "public"."category"("id","book_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_account_book_idx" ON "book_account" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "category_group_book_idx" ON "category_group" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "payment_type_book_idx" ON "payment_type" USING btree ("book_id");
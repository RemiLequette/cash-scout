CREATE TYPE "public"."compensation_side" AS ENUM('plus', 'minus');--> statement-breakpoint
CREATE TABLE "compensation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "compensation_id_book_id_unique" UNIQUE("id","book_id")
);
--> statement-breakpoint
ALTER TABLE "journal_entry" ALTER COLUMN "account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD COLUMN "compensation_id" uuid;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD COLUMN "compensation_side" "compensation_side";--> statement-breakpoint
ALTER TABLE "compensation" ADD CONSTRAINT "compensation_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "compensation_book_idx" ON "compensation" USING btree ("book_id");--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_compensation_id_book_id_compensation_id_book_id_fk" FOREIGN KEY ("compensation_id","book_id") REFERENCES "public"."compensation"("id","book_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_compensation_side_unique" UNIQUE("compensation_id","compensation_side");--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_compensation_check" CHECK (("journal_entry"."compensation_id" IS NULL) = ("journal_entry"."compensation_side" IS NULL));--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_account_check" CHECK (("journal_entry"."account_id" IS NULL) = ("journal_entry"."compensation_id" IS NOT NULL));
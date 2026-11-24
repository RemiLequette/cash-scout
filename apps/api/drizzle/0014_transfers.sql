CREATE TYPE "public"."transfer_leg" AS ENUM('source', 'destination');--> statement-breakpoint
CREATE TABLE "transfer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"delay_days" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "transfer_id_book_id_unique" UNIQUE("id","book_id"),
	CONSTRAINT "transfer_delay_check" CHECK ("transfer"."delay_days" BETWEEN 0 AND 60)
);
--> statement-breakpoint
ALTER TABLE "journal_entry" ADD COLUMN "transfer_id" uuid;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD COLUMN "transfer_leg" "transfer_leg";--> statement-breakpoint
ALTER TABLE "transfer" ADD CONSTRAINT "transfer_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transfer_book_idx" ON "transfer" USING btree ("book_id");--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_transfer_id_book_id_transfer_id_book_id_fk" FOREIGN KEY ("transfer_id","book_id") REFERENCES "public"."transfer"("id","book_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_transfer_leg_unique" UNIQUE("transfer_id","transfer_leg");--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_transfer_check" CHECK (("journal_entry"."transfer_id" IS NULL) = ("journal_entry"."transfer_leg" IS NULL));
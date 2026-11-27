CREATE TABLE "split" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "split_id_book_id_unique" UNIQUE("id","book_id")
);
--> statement-breakpoint
ALTER TABLE "journal_entry" ADD COLUMN "split_id" uuid;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD COLUMN "split_remainder" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "split" ADD CONSTRAINT "split_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "split_book_idx" ON "split" USING btree ("book_id");--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_split_id_book_id_split_id_book_id_fk" FOREIGN KEY ("split_id","book_id") REFERENCES "public"."split"("id","book_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entry_split_remainder_unique" ON "journal_entry" USING btree ("split_id") WHERE "journal_entry"."split_remainder";--> statement-breakpoint
CREATE INDEX "journal_entry_split_idx" ON "journal_entry" USING btree ("split_id");--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_split_check" CHECK (("journal_entry"."split_id" IS NOT NULL OR NOT "journal_entry"."split_remainder") AND ("journal_entry"."split_id" IS NULL OR ("journal_entry"."transfer_id" IS NULL AND "journal_entry"."compensation_id" IS NULL)));
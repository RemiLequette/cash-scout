ALTER TABLE "import_line" ADD COLUMN "previous_month_shifted" boolean;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD COLUMN "month_shifted" boolean DEFAULT false NOT NULL;
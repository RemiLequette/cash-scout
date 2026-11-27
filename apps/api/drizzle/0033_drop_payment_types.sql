-- A rule whose only action was the payment type would have none left: it goes.
-- The lines it was proposed on lose the reference (ON DELETE SET NULL); such a
-- rule proposed nothing else, so they are as if no rule had fitted them.
DELETE FROM "import_rule"
WHERE "payment_type_id" IS NOT NULL
  AND "sub_category_id" IS NULL
  AND "description" IS NULL
  AND NOT "ignore";--> statement-breakpoint
ALTER TABLE "import_line" DROP CONSTRAINT "import_line_payment_type_id_payment_type_id_fk";--> statement-breakpoint
ALTER TABLE "import_rule" DROP CONSTRAINT "import_rule_payment_type_id_payment_type_id_fk";--> statement-breakpoint
ALTER TABLE "journal_entry" DROP CONSTRAINT "journal_entry_payment_type_id_book_id_payment_type_id_book_id_fk";--> statement-breakpoint
DROP INDEX "journal_entry_payment_type_idx";--> statement-breakpoint
ALTER TABLE "import_line" DROP COLUMN "payment_type_id";--> statement-breakpoint
ALTER TABLE "import_rule" DROP COLUMN "payment_type_id";--> statement-breakpoint
ALTER TABLE "journal_entry" DROP COLUMN "payment_type_id";--> statement-breakpoint
-- Its row level security policies go with the table.
DROP TABLE "payment_type";

ALTER TABLE "import_rule" DROP CONSTRAINT "import_rule_account_id_book_account_id_fk";
--> statement-breakpoint
ALTER TABLE "import_rule" DROP COLUMN "account_id";
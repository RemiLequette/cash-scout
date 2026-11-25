ALTER TABLE "book_account" ADD COLUMN "opening_balance" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "book_account" ADD COLUMN "opening_book_amount" bigint DEFAULT 0 NOT NULL;
-- The built-in directions go: a category has a nature, and a nature has a sign
-- and, for the movements between accounts, a transfer flag. Budgets, the
-- journal and the dashboard read the nature.
ALTER TABLE "nature" ADD COLUMN "transfer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "nature" SET "transfer" = true WHERE "behavior" = 'transfer';--> statement-breakpoint
ALTER TABLE "category" DROP COLUMN "direction";--> statement-breakpoint
ALTER TABLE "nature" DROP COLUMN "behavior";--> statement-breakpoint
DROP TYPE "public"."direction";

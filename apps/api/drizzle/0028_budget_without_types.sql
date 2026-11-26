ALTER TABLE "budget_profile" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "budget_profile" CASCADE;--> statement-breakpoint
ALTER TABLE "category_budget" DROP CONSTRAINT "category_budget_type_check";--> statement-breakpoint
ALTER TABLE "category_budget" DROP CONSTRAINT IF EXISTS "category_budget_profile_id_book_id_budget_profile_id_book_id_fk";
--> statement-breakpoint
ALTER TABLE "category" DROP COLUMN "default_budget_type";--> statement-breakpoint
ALTER TABLE "category_budget" DROP COLUMN "type";--> statement-breakpoint
ALTER TABLE "category_budget" DROP COLUMN "amount";--> statement-breakpoint
ALTER TABLE "category_budget" DROP COLUMN "profile_id";--> statement-breakpoint
ALTER TABLE "category_budget" DROP COLUMN "consumption";--> statement-breakpoint
ALTER TABLE "category_budget" ADD CONSTRAINT "category_budget_months_check" CHECK (cardinality("category_budget"."months") = 12);--> statement-breakpoint
DROP TYPE "public"."budget_type";--> statement-breakpoint
DROP TYPE "public"."consumption_mode";
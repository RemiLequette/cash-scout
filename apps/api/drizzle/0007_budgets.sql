CREATE TYPE "public"."budget_type" AS ENUM('scheduled', 'periodic');--> statement-breakpoint
CREATE TYPE "public"."consumption_mode" AS ENUM('lapse', 'roll_over', 'annual_pool');--> statement-breakpoint
CREATE TABLE "budget_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"names" jsonb NOT NULL,
	"weights" integer[] NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "budget_profile_id_book_id_unique" UNIQUE("id","book_id"),
	CONSTRAINT "budget_profile_weights_check" CHECK (cardinality("budget_profile"."weights") = 12
        AND array_position("budget_profile"."weights", NULL) IS NULL
        AND 0 <= ALL("budget_profile"."weights")
        AND "budget_profile"."weights"[1] + "budget_profile"."weights"[2] + "budget_profile"."weights"[3] + "budget_profile"."weights"[4]
          + "budget_profile"."weights"[5] + "budget_profile"."weights"[6] + "budget_profile"."weights"[7] + "budget_profile"."weights"[8]
          + "budget_profile"."weights"[9] + "budget_profile"."weights"[10] + "budget_profile"."weights"[11] + "budget_profile"."weights"[12] = 10000)
);
--> statement-breakpoint
CREATE TABLE "category_budget" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"type" "budget_type" NOT NULL,
	"assumptions" text DEFAULT '' NOT NULL,
	"amount" bigint,
	"profile_id" uuid,
	"consumption" "consumption_mode",
	"account_id" uuid,
	"exchange_rate" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_budget_year_unique" UNIQUE("category_id","year"),
	CONSTRAINT "category_budget_type_check" CHECK (("category_budget"."type" = 'periodic' AND "category_budget"."amount" IS NOT NULL AND "category_budget"."profile_id" IS NOT NULL
          AND "category_budget"."consumption" IS NOT NULL)
        OR ("category_budget"."type" = 'scheduled' AND "category_budget"."amount" IS NULL AND "category_budget"."profile_id" IS NULL
          AND "category_budget"."consumption" IS NULL AND "category_budget"."account_id" IS NULL)),
	CONSTRAINT "category_budget_rate_check" CHECK (("category_budget"."account_id" IS NULL) = ("category_budget"."exchange_rate" IS NULL) AND ("category_budget"."exchange_rate" IS NULL OR "category_budget"."exchange_rate" > 0))
);
--> statement-breakpoint
ALTER TABLE "category" ADD COLUMN "default_budget_type" "budget_type" DEFAULT 'periodic' NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_profile" ADD CONSTRAINT "budget_profile_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_budget" ADD CONSTRAINT "category_budget_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_budget" ADD CONSTRAINT "category_budget_category_id_book_id_category_id_book_id_fk" FOREIGN KEY ("category_id","book_id") REFERENCES "public"."category"("id","book_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_budget" ADD CONSTRAINT "category_budget_profile_id_book_id_budget_profile_id_book_id_fk" FOREIGN KEY ("profile_id","book_id") REFERENCES "public"."budget_profile"("id","book_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_budget" ADD CONSTRAINT "category_budget_account_id_book_id_book_account_id_book_id_fk" FOREIGN KEY ("account_id","book_id") REFERENCES "public"."book_account"("id","book_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_profile_book_idx" ON "budget_profile" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "category_budget_book_year_idx" ON "category_budget" USING btree ("book_id","year");
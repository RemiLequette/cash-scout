CREATE TABLE "budget_settlement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"settled_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_settlement_month_unique" UNIQUE("category_id","year","month"),
	CONSTRAINT "budget_settlement_month_check" CHECK ("budget_settlement"."month" BETWEEN 1 AND 12)
);
--> statement-breakpoint
ALTER TABLE "budget_settlement" ADD CONSTRAINT "budget_settlement_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_settlement" ADD CONSTRAINT "budget_settlement_category_id_book_id_category_id_book_id_fk" FOREIGN KEY ("category_id","book_id") REFERENCES "public"."category"("id","book_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_settlement_book_year_idx" ON "budget_settlement" USING btree ("book_id","year");
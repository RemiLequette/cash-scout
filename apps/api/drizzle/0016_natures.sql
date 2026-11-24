CREATE TABLE "balance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"names" jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "balance_id_book_id_unique" UNIQUE("id","book_id")
);
--> statement-breakpoint
CREATE TABLE "balance_nature" (
	"book_id" uuid NOT NULL,
	"balance_id" uuid NOT NULL,
	"nature_id" uuid NOT NULL,
	CONSTRAINT "balance_nature_balance_id_nature_id_pk" PRIMARY KEY("balance_id","nature_id")
);
--> statement-breakpoint
CREATE TABLE "nature" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"names" jsonb NOT NULL,
	"behavior" "direction" NOT NULL,
	"sign" smallint NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "nature_id_book_id_unique" UNIQUE("id","book_id"),
	CONSTRAINT "nature_sign_check" CHECK ("nature"."sign" IN (1, -1))
);
--> statement-breakpoint
ALTER TABLE "category" ADD COLUMN "nature_id" uuid;--> statement-breakpoint
ALTER TABLE "balance" ADD CONSTRAINT "balance_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_nature" ADD CONSTRAINT "balance_nature_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_nature" ADD CONSTRAINT "balance_nature_balance_id_book_id_balance_id_book_id_fk" FOREIGN KEY ("balance_id","book_id") REFERENCES "public"."balance"("id","book_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_nature" ADD CONSTRAINT "balance_nature_nature_id_book_id_nature_id_book_id_fk" FOREIGN KEY ("nature_id","book_id") REFERENCES "public"."nature"("id","book_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nature" ADD CONSTRAINT "nature_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "balance_book_idx" ON "balance" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "nature_book_idx" ON "nature" USING btree ("book_id");--> statement-breakpoint

-- Every existing book starts with the four natures, one per direction, named
-- in its languages (French, or English for any other), and its categories
-- take the nature of their direction.
INSERT INTO "nature" ("book_id", "names", "behavior", "sign", "position")
SELECT b."id",
  COALESCE(
    (SELECT jsonb_object_agg(l."language", CASE WHEN split_part(l."language", '-', 1) = 'fr' THEN v.fr ELSE v.en END)
       FROM "book_language" l WHERE l."book_id" = b."id"),
    jsonb_build_object(b."default_language", v.en)
  ),
  v.behavior::"direction", v.sign, v.position
FROM "book" b
CROSS JOIN (VALUES
  ('income', 'Revenus', 'Income', 1, 0),
  ('expense', 'Dépenses', 'Expenses', -1, 1),
  ('saving', 'Épargne', 'Savings', -1, 2),
  ('transfer', 'Virements', 'Transfers', 1, 3)
) AS v(behavior, fr, en, sign, position);--> statement-breakpoint
UPDATE "category" c SET "nature_id" = n."id"
FROM "nature" n
WHERE n."book_id" = c."book_id" AND n."behavior" = c."direction";--> statement-breakpoint
ALTER TABLE "category" ALTER COLUMN "nature_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_nature_id_book_id_nature_id_book_id_fk" FOREIGN KEY ("nature_id","book_id") REFERENCES "public"."nature"("id","book_id") ON DELETE no action ON UPDATE no action;

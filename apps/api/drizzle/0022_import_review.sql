CREATE TYPE "public"."rule_direction" AS ENUM('any', 'in', 'out');--> statement-breakpoint
ALTER TYPE "public"."import_line_status" ADD VALUE 'imported';--> statement-breakpoint
CREATE TABLE "import_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"text" text,
	"bank_category" text,
	"account_id" uuid,
	"direction" "rule_direction" DEFAULT 'any' NOT NULL,
	"min_amount" numeric,
	"max_amount" numeric,
	"sub_category_id" uuid,
	"description" text,
	"ignore" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "import_rule_id_book_id_unique" UNIQUE("id","book_id")
);
--> statement-breakpoint
ALTER TABLE "import_line" ADD COLUMN "sub_category_id" uuid;--> statement-breakpoint
ALTER TABLE "import_line" ADD COLUMN "rule_id" uuid;--> statement-breakpoint
ALTER TABLE "import_line" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "import_line" ADD COLUMN "entry_id" uuid;--> statement-breakpoint
ALTER TABLE "import_line" ADD COLUMN "previous_date" date;--> statement-breakpoint
ALTER TABLE "import_line" ADD COLUMN "previous_reconciled" boolean;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "import_rule" ADD CONSTRAINT "import_rule_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rule" ADD CONSTRAINT "import_rule_account_id_book_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."book_account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rule" ADD CONSTRAINT "import_rule_sub_category_id_sub_category_id_fk" FOREIGN KEY ("sub_category_id") REFERENCES "public"."sub_category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_rule_book_idx" ON "import_rule" USING btree ("book_id","position");--> statement-breakpoint
ALTER TABLE "import_line" ADD CONSTRAINT "import_line_sub_category_id_sub_category_id_fk" FOREIGN KEY ("sub_category_id") REFERENCES "public"."sub_category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_line" ADD CONSTRAINT "import_line_rule_id_import_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."import_rule"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_line" ADD CONSTRAINT "import_line_entry_id_journal_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entry"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_import_batch_id_import_batch_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batch"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_line_entry_idx" ON "import_line" USING btree ("entry_id");
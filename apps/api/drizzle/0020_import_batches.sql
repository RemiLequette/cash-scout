CREATE TYPE "public"."import_line_status" AS ENUM('review', 'validated', 'ignored');--> statement-breakpoint
CREATE TABLE "import_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"preset" text NOT NULL,
	"file_name" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "import_batch_id_book_id_unique" UNIQUE("id","book_id")
);
--> statement-breakpoint
CREATE TABLE "import_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"row" integer NOT NULL,
	"date" date NOT NULL,
	"value_date" date,
	"amount" bigint NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"counterparty" text DEFAULT '' NOT NULL,
	"memo" text DEFAULT '' NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"bank_category" text DEFAULT '' NOT NULL,
	"balance" bigint,
	"account_number" text DEFAULT '' NOT NULL,
	"raw" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"status" "import_line_status" DEFAULT 'review' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_account_id_book_id_book_account_id_book_id_fk" FOREIGN KEY ("account_id","book_id") REFERENCES "public"."book_account"("id","book_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_line" ADD CONSTRAINT "import_line_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_line" ADD CONSTRAINT "import_line_batch_id_book_id_import_batch_id_book_id_fk" FOREIGN KEY ("batch_id","book_id") REFERENCES "public"."import_batch"("id","book_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_batch_book_idx" ON "import_batch" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "import_batch_account_idx" ON "import_batch" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "import_line_batch_idx" ON "import_line" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "import_line_fingerprint_idx" ON "import_line" USING btree ("book_id","fingerprint");
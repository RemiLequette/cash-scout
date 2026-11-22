CREATE TABLE "journal_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"date" date NOT NULL,
	"account_id" uuid NOT NULL,
	"sub_category_id" uuid NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"payment_type_id" uuid,
	"amount" bigint NOT NULL,
	"planned_amount" bigint NOT NULL,
	"exchange_rate" numeric NOT NULL,
	"book_amount" bigint NOT NULL,
	"original_amount" bigint,
	"original_currency" char(3),
	"reconciled" boolean DEFAULT false NOT NULL,
	"schedule_id" uuid,
	"link_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entry_original_check" CHECK (("journal_entry"."original_amount" IS NULL) = ("journal_entry"."original_currency" IS NULL)),
	CONSTRAINT "journal_entry_rate_check" CHECK ("journal_entry"."exchange_rate" > 0)
);
--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_account_id_book_id_book_account_id_book_id_fk" FOREIGN KEY ("account_id","book_id") REFERENCES "public"."book_account"("id","book_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_sub_category_id_book_id_sub_category_id_book_id_fk" FOREIGN KEY ("sub_category_id","book_id") REFERENCES "public"."sub_category"("id","book_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_payment_type_id_book_id_payment_type_id_book_id_fk" FOREIGN KEY ("payment_type_id","book_id") REFERENCES "public"."payment_type"("id","book_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_entry_book_date_idx" ON "journal_entry" USING btree ("book_id","date");--> statement-breakpoint
CREATE INDEX "journal_entry_account_idx" ON "journal_entry" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "journal_entry_sub_category_idx" ON "journal_entry" USING btree ("sub_category_id");--> statement-breakpoint
CREATE INDEX "journal_entry_payment_type_idx" ON "journal_entry" USING btree ("payment_type_id");
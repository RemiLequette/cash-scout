CREATE TYPE "public"."loan_deferral" AS ENUM('none', 'interest', 'total');--> statement-breakpoint
CREATE TYPE "public"."loan_event_kind" AS ENUM('drawdown', 'repayment', 'buyback', 'insurance');--> statement-breakpoint
CREATE TYPE "public"."loan_insurance" AS ENUM('none', 'initial', 'remaining');--> statement-breakpoint
CREATE TYPE "public"."loan_part" AS ENUM('payment', 'insurance', 'penalty');--> statement-breakpoint
CREATE TYPE "public"."loan_repayment_keeps" AS ENUM('payment', 'term');--> statement-breakpoint
CREATE TABLE "loan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"name" text NOT NULL,
	"lender" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"amount" bigint NOT NULL,
	"rate" numeric NOT NULL,
	"term" integer NOT NULL,
	"start" date NOT NULL,
	"insurance_mode" "loan_insurance" DEFAULT 'none' NOT NULL,
	"insurance_rate" numeric DEFAULT '0' NOT NULL,
	"insurance_separate" boolean DEFAULT false NOT NULL,
	"insurance_account_id" uuid,
	"penalty_sub_category_id" uuid,
	"deferral_mode" "loan_deferral" DEFAULT 'none' NOT NULL,
	"deferral_months" integer DEFAULT 0 NOT NULL,
	"account_id" uuid NOT NULL,
	"capital_sub_category_id" uuid NOT NULL,
	"interest_sub_category_id" uuid NOT NULL,
	"insurance_sub_category_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "loan_id_book_id_unique" UNIQUE("id","book_id"),
	CONSTRAINT "loan_amount_check" CHECK ("loan"."amount" > 0),
	CONSTRAINT "loan_term_check" CHECK ("loan"."term" BETWEEN 1 AND 600),
	CONSTRAINT "loan_rate_check" CHECK ("loan"."rate" >= 0 AND "loan"."insurance_rate" >= 0),
	CONSTRAINT "loan_deferral_check" CHECK ("loan"."deferral_months" >= 0 AND "loan"."deferral_months" < "loan"."term" AND ("loan"."deferral_mode" = 'none') = ("loan"."deferral_months" = 0)),
	CONSTRAINT "loan_insurance_check" CHECK ("loan"."insurance_mode" = 'none' OR "loan"."insurance_sub_category_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "loan_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"loan_id" uuid NOT NULL,
	"date" date NOT NULL,
	"kind" "loan_event_kind" NOT NULL,
	"amount" bigint,
	"keeps" "loan_repayment_keeps" DEFAULT 'payment' NOT NULL,
	"insurance_mode" "loan_insurance",
	"insurance_rate" numeric,
	"insurance_separate" boolean DEFAULT false NOT NULL,
	"insurance_account_id" uuid,
	"penalty" bigint,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "loan_event_id_book_id_unique" UNIQUE("id","book_id"),
	CONSTRAINT "loan_event_amount_check" CHECK ("loan_event"."amount" IS NULL OR "loan_event"."amount" > 0),
	CONSTRAINT "loan_event_penalty_check" CHECK ("loan_event"."penalty" IS NULL OR ("loan_event"."penalty" > 0 AND "loan_event"."kind" IN ('repayment', 'buyback'))),
	CONSTRAINT "loan_event_kind_check" CHECK (("loan_event"."kind" <> 'drawdown' OR "loan_event"."amount" IS NOT NULL) AND ("loan_event"."kind" NOT IN ('buyback', 'insurance') OR "loan_event"."amount" IS NULL) AND (("loan_event"."kind" = 'insurance') = ("loan_event"."insurance_mode" IS NOT NULL AND "loan_event"."insurance_rate" IS NOT NULL)))
);
--> statement-breakpoint
ALTER TABLE "journal_entry" ADD COLUMN "loan_id" uuid;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD COLUMN "loan_part" "loan_part" DEFAULT 'payment' NOT NULL;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_account_id_book_id_book_account_id_book_id_fk" FOREIGN KEY ("account_id","book_id") REFERENCES "public"."book_account"("id","book_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_capital_sub_category_id_book_id_sub_category_id_book_id_fk" FOREIGN KEY ("capital_sub_category_id","book_id") REFERENCES "public"."sub_category"("id","book_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_interest_sub_category_id_book_id_sub_category_id_book_id_fk" FOREIGN KEY ("interest_sub_category_id","book_id") REFERENCES "public"."sub_category"("id","book_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_insurance_sub_category_id_book_id_sub_category_id_book_id_fk" FOREIGN KEY ("insurance_sub_category_id","book_id") REFERENCES "public"."sub_category"("id","book_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_insurance_account_id_book_id_book_account_id_book_id_fk" FOREIGN KEY ("insurance_account_id","book_id") REFERENCES "public"."book_account"("id","book_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_penalty_sub_category_id_book_id_sub_category_id_book_id_fk" FOREIGN KEY ("penalty_sub_category_id","book_id") REFERENCES "public"."sub_category"("id","book_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_event" ADD CONSTRAINT "loan_event_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_event" ADD CONSTRAINT "loan_event_loan_id_book_id_loan_id_book_id_fk" FOREIGN KEY ("loan_id","book_id") REFERENCES "public"."loan"("id","book_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_event" ADD CONSTRAINT "loan_event_insurance_account_id_book_id_book_account_id_book_id_fk" FOREIGN KEY ("insurance_account_id","book_id") REFERENCES "public"."book_account"("id","book_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "loan_book_idx" ON "loan" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "loan_event_loan_idx" ON "loan_event" USING btree ("loan_id");--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_loan_id_book_id_loan_id_book_id_fk" FOREIGN KEY ("loan_id","book_id") REFERENCES "public"."loan"("id","book_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_entry_loan_idx" ON "journal_entry" USING btree ("loan_id");--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_loan_check" CHECK ("journal_entry"."loan_id" IS NOT NULL OR "journal_entry"."loan_part" = 'payment');
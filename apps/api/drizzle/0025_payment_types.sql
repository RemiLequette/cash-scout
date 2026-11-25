ALTER TABLE "import_line" ADD COLUMN "payment_type_id" uuid;--> statement-breakpoint
ALTER TABLE "import_rule" ADD COLUMN "payment_type_id" uuid;--> statement-breakpoint
ALTER TABLE "import_line" ADD CONSTRAINT "import_line_payment_type_id_payment_type_id_fk" FOREIGN KEY ("payment_type_id") REFERENCES "public"."payment_type"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rule" ADD CONSTRAINT "import_rule_payment_type_id_payment_type_id_fk" FOREIGN KEY ("payment_type_id") REFERENCES "public"."payment_type"("id") ON DELETE set null ON UPDATE no action;
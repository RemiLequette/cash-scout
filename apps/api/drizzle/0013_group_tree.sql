ALTER TABLE "category_group" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "category_group" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "category_group" ADD CONSTRAINT "category_group_parent_id_book_id_category_group_id_book_id_fk" FOREIGN KEY ("parent_id","book_id") REFERENCES "public"."category_group"("id","book_id") ON DELETE no action ON UPDATE no action;
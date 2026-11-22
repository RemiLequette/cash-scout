CREATE TABLE "book" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"currency" char(3) NOT NULL,
	"default_language" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

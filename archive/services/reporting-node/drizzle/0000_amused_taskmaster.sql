CREATE SCHEMA IF NOT EXISTS "reporting";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reporting"."report_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"question" text NOT NULL,
	"sql_queries" jsonb DEFAULT '[]'::jsonb,
	"output" text,
	"tags" text[] DEFAULT '{}'::text[],
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reporting"."staged_uploads" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_name" text NOT NULL,
	"table_name" text NOT NULL,
	"columns" jsonb NOT NULL,
	"row_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"expires_at" timestamp with time zone DEFAULT NOW() + INTERVAL '24 hours'
);

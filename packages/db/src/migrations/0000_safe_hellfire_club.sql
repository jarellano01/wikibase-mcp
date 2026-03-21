CREATE SCHEMA "ai_wiki";
--> statement-breakpoint
CREATE TABLE "ai_wiki"."entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"summary" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"type" text DEFAULT 'note' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "entries_created_at_idx" ON "ai_wiki"."entries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "entries_type_idx" ON "ai_wiki"."entries" USING btree ("type");
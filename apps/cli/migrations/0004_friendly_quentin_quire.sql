CREATE TABLE "ai_wiki"."block_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"block_id" uuid NOT NULL,
	"body" text NOT NULL,
	"resolved" text DEFAULT 'false' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_wiki"."block_comments" ADD CONSTRAINT "block_comments_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "ai_wiki"."blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "block_comments_block_id_idx" ON "ai_wiki"."block_comments" USING btree ("block_id");
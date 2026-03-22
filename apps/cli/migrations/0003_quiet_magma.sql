CREATE TABLE "ai_wiki"."block_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"block_id" uuid NOT NULL,
	"content" text NOT NULL,
	"source" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_wiki"."blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"type" text NOT NULL,
	"content" text NOT NULL,
	"position" integer NOT NULL,
	"metadata" jsonb,
	"embedding" vector(384),
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_wiki"."entries" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "ai_wiki"."block_revisions" ADD CONSTRAINT "block_revisions_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "ai_wiki"."blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_wiki"."blocks" ADD CONSTRAINT "blocks_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "ai_wiki"."entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "block_revisions_block_id_idx" ON "ai_wiki"."block_revisions" USING btree ("block_id");--> statement-breakpoint
CREATE INDEX "blocks_entry_id_idx" ON "ai_wiki"."blocks" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "blocks_entry_position_idx" ON "ai_wiki"."blocks" USING btree ("entry_id","position");
CREATE INDEX IF NOT EXISTS idx_blocks_embedding ON ai_wiki.blocks USING hnsw (embedding vector_cosine_ops);
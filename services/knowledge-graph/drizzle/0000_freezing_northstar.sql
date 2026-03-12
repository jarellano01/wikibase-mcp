CREATE SCHEMA "knowledge_graph";
--> statement-breakpoint
CREATE TABLE "knowledge_graph"."knowledge_base" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"key" text NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(768),
	"scope" text DEFAULT 'global' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[],
	"source" text DEFAULT 'manual' NOT NULL,
	"source_file" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "knowledge_base_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "knowledge_graph"."knowledge_candidates" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"key" text NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(768),
	"rationale" text,
	"scope" text DEFAULT 'global' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[],
	"session_id" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "knowledge_graph"."session_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"sequence" integer NOT NULL,
	"entry_type" text NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(768),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "knowledge_graph"."sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"scope" text DEFAULT 'global' NOT NULL,
	"user_name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "knowledge_graph"."knowledge_candidates" ADD CONSTRAINT "knowledge_candidates_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "knowledge_graph"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_graph"."session_entries" ADD CONSTRAINT "session_entries_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "knowledge_graph"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_kb_scope" ON "knowledge_graph"."knowledge_base" USING btree ("scope");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_session_sequence" ON "knowledge_graph"."session_entries" USING btree ("session_id","sequence");--> statement-breakpoint
CREATE INDEX "idx_kb_tags" ON "knowledge_graph"."knowledge_base" USING gin ("tags");
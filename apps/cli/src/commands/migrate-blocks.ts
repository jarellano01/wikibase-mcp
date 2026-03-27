import { Command } from "commander";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { toMarkdown } from "mdast-util-to-markdown";
import type { RootContent } from "mdast";
import { getEntryById } from "@wikibase/db";
import { createBlock, getBlocksByEntry } from "@wikibase/db/blocks";
import { generateEmbedding } from "@wikibase/db/embeddings";

function mapNodeType(node: RootContent): string {
  switch (node.type) {
    case "heading": return "heading";
    case "paragraph": return "paragraph";
    case "image": return "image";
    case "code": return "code";
    case "blockquote": return "quote";
    case "thematicBreak": return "divider";
    case "list": return "list";
    default: return "paragraph";
  }
}

function extractMetadata(node: RootContent): Record<string, unknown> | null {
  if (node.type === "heading") return { level: node.depth };
  if (node.type === "code" && node.lang) return { language: node.lang };
  if (node.type === "list") return { ordered: node.ordered ?? false };
  if (node.type === "image") return { src: node.url, alt: node.alt ?? "", title: node.title ?? "" };
  return null;
}

export const migrateBlocksCommand = new Command("migrate-blocks")
  .description("Parse an entry's content into blocks (one-time migration for post entries)")
  .argument("<id>", "Entry UUID")
  .option("--dry-run", "Preview blocks without writing to the database")
  .action(async (id: string, opts: { dryRun?: boolean }) => {
    const entry = await getEntryById(id);
    if (!entry) {
      console.error(`No entry found: ${id}`);
      process.exit(1);
    }
    const existingBlocks = await getBlocksByEntry(id);
    if (existingBlocks.length > 0) {
      console.error(`Entry already has ${existingBlocks.length} block(s) — skipping to avoid duplicates.`);
      process.exit(1);
    }

    const tree = unified().use(remarkParse).parse(entry.content);
    const nodes = tree.children;

    console.log(`\nEntry: ${entry.title}`);
    console.log(`Blocks to create: ${nodes.length}\n`);

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const type = mapNodeType(node);
      const content = toMarkdown(node).trim();
      const metadata = extractMetadata(node);

      console.log(`  [${i}] ${type}${metadata ? ` ${JSON.stringify(metadata)}` : ""}`);
      console.log(`      ${content.slice(0, 80)}${content.length > 80 ? "…" : ""}`);

      if (!opts.dryRun) {
        const embedding = await generateEmbedding(content);
        await createBlock({
          entryId: id,
          type,
          content,
          position: i,
          metadata: metadata ?? undefined,
          embedding,
        });
      }
    }

    if (!opts.dryRun) {
      // status is already set on the entries.status column — no action needed
      console.log(`\n✓ Created ${nodes.length} blocks for entry ${id}`);
    } else {
      console.log(`\nDry run — no blocks written.`);
    }

    process.exit(0);
  });

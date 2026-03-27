import { readFileSync } from "fs";
import { basename, extname } from "path";
import { Command } from "commander";
import { input, confirm } from "@inquirer/prompts";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { toMarkdown } from "mdast-util-to-markdown";
import type { RootContent } from "mdast";
import { createEntry, updateEntry } from "@wikibase/db";
import { createBlock } from "@wikibase/db/blocks";
import { generateEmbedding } from "@wikibase/db/embeddings";

// Matches the same type mapping used in migrate-blocks.ts
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

export const importMdCommand = new Command("import-md")
  .description("Import a markdown file as a new entry with blocks")
  .argument("<file>", "Path to the markdown file")
  .action(async (file: string) => {
    // Read file content from disk
    let content: string;
    try {
      content = readFileSync(file, "utf-8");
    } catch {
      console.error(`Could not read file: ${file}`);
      process.exit(1);
    }

    // Derive default title from filename (strip extension)
    const defaultTitle = basename(file, extname(file));

    // Prompt the user to confirm or edit the title
    const title = await input({
      message: "Title:",
      default: defaultTitle,
    });

    // Prompt for optional tags
    const tagsInput = await input({
      message: "Tags (comma-separated, optional):",
    });
    const tags = tagsInput
      ? tagsInput.split(",").map((t) => t.trim()).filter(Boolean)
      : [];

    // Confirm before creating
    const ok = await confirm({ message: `Import "${title}" as a draft post?` });
    if (!ok) {
      console.log("Aborted.");
      process.exit(0);
    }

    // Generate embedding for the full content
    process.stdout.write("Generating embedding...");
    const embedding = await generateEmbedding(`${title} ${content}`);
    process.stdout.write(" done\n");

    // Create the entry
    const entry = await createEntry({
      title,
      type: "post",
      content,
      summary: null,
      tags,
      embedding,
    });

    console.log(`Created entry: ${entry.id}`);

    // Parse the markdown content into AST nodes and create blocks
    const tree = unified().use(remarkParse).parse(content);
    const nodes = tree.children;

    console.log(`Parsing ${nodes.length} block(s)...`);

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const type = mapNodeType(node);
      const blockContent = toMarkdown(node).trim();
      const metadata = extractMetadata(node);

      const blockEmbedding = await generateEmbedding(blockContent);
      await createBlock({
        entryId: entry.id,
        type,
        content: blockContent,
        position: i,
        metadata: metadata ?? undefined,
        embedding: blockEmbedding,
      });
    }

    // status defaults to "draft" from the column default — no explicit set needed

    console.log(`\nImported "${title}" as draft post.`);
    console.log(`Entry ID: ${entry.id}`);
    console.log(`Blocks created: ${nodes.length}`);
  });

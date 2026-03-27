import { Command } from "commander";
import { input, select, editor, confirm } from "@inquirer/prompts";
import { getEntryById, updateEntry } from "@wikibase/db";
import { generateEmbedding } from "@wikibase/db/embeddings";
import { getBlocksByEntry, updateBlock } from "@wikibase/db/blocks";

export const updateCommand = new Command("update")
  .description("Update an existing wiki entry")
  .argument("<id>", "Entry UUID")
  .action(async (id: string) => {
    const existing = await getEntryById(id);
    if (!existing) {
      console.error(`No entry found: ${id}`);
      process.exit(1);
    }

    console.log(`Updating: [${existing.id}] ${existing.title}\n`);

    const title = await input({ message: "Title:", default: existing.title });

    const type = await select({
      message: "Type:",
      choices: [{ value: "note" }, { value: "idea" }, { value: "article" }, { value: "thought" }],
      default: existing.type,
    });

    const content = await editor({ message: "Content (opens editor):", default: existing.content });

    const summary = await input({
      message: "Summary:",
      default: existing.summary ?? "",
    });

    const tagsInput = await input({
      message: "Tags (comma-separated):",
      default: existing.tags.join(", "),
    });
    const tags = tagsInput ? tagsInput.split(",").map((t) => t.trim()).filter(Boolean) : [];

    const contentChanged = title !== existing.title || content !== existing.content || summary !== (existing.summary ?? "");

    let embedding = existing.embedding;
    if (contentChanged) {
      process.stdout.write("Regenerating embedding...");
      embedding = await generateEmbedding(`${title} ${summary} ${content}`);
      process.stdout.write(" done\n");
    }

    const updated = await updateEntry(id, {
      title,
      type,
      content,
      summary: summary || null,
      tags,
      embedding,
    });

    if (content !== existing.content) {
      const existingBlocks = await getBlocksByEntry(id);
      const textBlock = existingBlocks.find((b) => b.type === "text");
      if (textBlock) await updateBlock(textBlock.id, content, "human");
    }

    console.log(`\nUpdated: [${updated!.id}] ${updated!.title}`);
  });

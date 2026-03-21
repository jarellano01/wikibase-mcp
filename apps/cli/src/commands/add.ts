import { Command } from "commander";
import { input, select, editor } from "@inquirer/prompts";
import { createEntry } from "@ai-wiki/db";
import { generateEmbedding } from "@ai-wiki/db/embeddings";

export const addCommand = new Command("add")
  .description("Add a new entry to the wiki")
  .action(async () => {
    const title = await input({ message: "Title:" });

    const type = await select({
      message: "Type:",
      choices: [
        { value: "note" },
        { value: "idea" },
        { value: "article" },
        { value: "thought" },
      ],
    });

    const content = await editor({ message: "Content (opens editor):" });

    const summary = await input({
      message: "Summary (optional, used for token-efficient AI retrieval):",
    });

    const tagsInput = await input({
      message: "Tags (comma-separated, optional):",
    });
    const tags = tagsInput
      ? tagsInput.split(",").map((t) => t.trim()).filter(Boolean)
      : [];

    process.stdout.write("Generating embedding...");
    const embedding = await generateEmbedding(`${title} ${summary || ""} ${content}`);
    process.stdout.write(" done\n");

    const entry = await createEntry({ title, type, content, summary: summary || null, tags, embedding });
    console.log(`\nAdded: [${entry.id}] ${entry.title}`);
  });

import { Command } from "commander";
import { listEntries } from "@wikibase/db";

export const listCommand = new Command("list")
  .description("List recent entries")
  .option("-l, --limit <n>", "Number of entries", "20")
  .action(async (opts) => {
    const entries = await listEntries(parseInt(opts.limit));
    if (entries.length === 0) {
      console.log("No entries yet. Run `wiki add` to create one.");
      return;
    }
    for (const entry of entries) {
      console.log(`[${entry.id}] ${entry.title} (${entry.type})`);
      console.log(`  Tags: ${entry.tags.join(", ") || "none"} | ${entry.createdAt.toISOString()}`);
    }
  });

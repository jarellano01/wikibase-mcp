import { Command } from "commander";
import { searchEntries } from "@ai-wiki/db";
import { generateEmbedding } from "@ai-wiki/db/embeddings";

export const searchCommand = new Command("search")
  .description("Search entries by semantic similarity or keyword")
  .argument("<query>", "Search query")
  .action(async (query: string) => {
    const queryEmbedding = await generateEmbedding(query);
    const results = await searchEntries(query, queryEmbedding);
    if (results.length === 0) {
      console.log("No results found.");
      return;
    }
    for (const entry of results) {
      console.log(`[${entry.id}] ${entry.title} (${entry.type})`);
      if (entry.summary) console.log(`  ${entry.summary}`);
      console.log(`  Tags: ${entry.tags.join(", ") || "none"} | ${entry.createdAt.toISOString()}`);
      console.log();
    }
  });

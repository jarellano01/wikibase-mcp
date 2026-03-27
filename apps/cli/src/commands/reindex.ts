import { Command } from "commander";
import { listEntries, updateEntry } from "@wikibase/db";
import { generateEmbedding } from "@wikibase/db/embeddings";

export const reindexCommand = new Command("reindex")
  .description("Backfill embeddings for all entries missing one")
  .action(async () => {
    const all = await listEntries(1000);
    const missing = all.filter((e) => !e.embedding);

    if (missing.length === 0) {
      console.log("All entries already have embeddings.");
      return;
    }

    console.log(`Generating embeddings for ${missing.length} entries...`);
    let done = 0;
    for (const entry of missing) {
      const embedding = await generateEmbedding(
        `${entry.title} ${entry.summary ?? ""} ${entry.content}`
      );
      await updateEntry(entry.id, { embedding });
      done++;
      process.stdout.write(`\r${done}/${missing.length}`);
    }
    console.log("\nReindex complete.");
  });

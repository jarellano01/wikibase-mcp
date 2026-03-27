import { Command } from "commander";
import { getEntryById } from "@wikibase/db";

export const getCommand = new Command("get")
  .description("Get a full entry by ID")
  .argument("<id>", "Entry UUID")
  .action(async (id: string) => {
    const entry = await getEntryById(id);
    if (!entry) {
      console.error(`No entry found with id: ${id}`);
      process.exit(1);
    }
    console.log(`# ${entry.title}`);
    console.log(`Type: ${entry.type} | Tags: ${entry.tags.join(", ") || "none"}`);
    console.log(`Created: ${entry.createdAt.toISOString()}\n`);
    if (entry.summary) console.log(`**Summary:** ${entry.summary}\n`);
    console.log(entry.content);
  });

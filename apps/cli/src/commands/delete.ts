import { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import { deleteEntry, getEntryById } from "@wikibase/db";

export const deleteCommand = new Command("delete")
  .description("Delete an entry by ID")
  .argument("<id>", "Entry UUID")
  .action(async (id: string) => {
    const entry = await getEntryById(id);
    if (!entry) {
      console.error(`No entry found with id: ${id}`);
      process.exit(1);
    }

    const confirmed = await confirm({
      message: `Delete "${entry.title}"?`,
      default: false,
    });

    if (!confirmed) {
      console.log("Aborted.");
      return;
    }

    await deleteEntry(id);
    console.log(`Deleted: ${entry.title}`);
  });

import { writeFileSync } from "fs";
import { join, resolve } from "path";
import { Command } from "commander";
import { getEntryById } from "@wikibase/db";
import { getBlocksByEntry } from "@wikibase/db/blocks";

/**
 * Slugify a title for use as a filename:
 * lowercase, strip non-alphanumeric characters, replace whitespace/hyphens with a single hyphen.
 */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")   // remove special chars
    .replace(/[\s-]+/g, "-")         // collapse whitespace and hyphens
    .replace(/^-+|-+$/g, "");        // trim leading/trailing hyphens
}

export const exportMdCommand = new Command("export-md")
  .description("Export an entry as a markdown file")
  .argument("<id>", "Entry UUID")
  .argument("[outDir]", "Output directory (default: current directory)", ".")
  .action(async (id: string, outDir: string) => {
    // Fetch entry and blocks in parallel
    const [entry, entryBlocks] = await Promise.all([
      getEntryById(id),
      getBlocksByEntry(id),
    ]);

    if (!entry) {
      console.error(`No entry found: ${id}`);
      process.exit(1);
    }

    // Assemble content: use blocks when available, otherwise fall back to entry.content
    const content =
      entryBlocks.length > 0
        ? entryBlocks.map((b) => b.content).join("\n\n")
        : entry.content;

    // Build the output file path
    const slug = slugify(entry.title) || id;
    const filename = `${slug}.md`;
    const outputPath = resolve(join(outDir, filename));

    writeFileSync(outputPath, content, "utf-8");

    console.log(`Exported "${entry.title}" to: ${outputPath}`);
  });

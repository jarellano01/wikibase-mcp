#!/usr/bin/env node
import { Command } from "commander";
import { addCommand } from "./commands/add.js";
import { getCommand } from "./commands/get.js";
import { searchCommand } from "./commands/search.js";
import { listCommand } from "./commands/list.js";
import { deleteCommand } from "./commands/delete.js";
import { updateCommand } from "./commands/update.js";
import { mcpCommand } from "./commands/setup.js";
import { serveCommand } from "./commands/serve.js";
import { reindexCommand } from "./commands/reindex.js";
import { exportCommand } from "./commands/export.js";
import { migrateBlocksCommand } from "./commands/migrate-blocks.js";
import { importMdCommand } from "./commands/import-md.js";
import { exportMdCommand } from "./commands/export-md.js";
import { instanceCommand } from "./commands/instance.js";
import { aiHowToCommand } from "./commands/ai-how-to.js";

const program = new Command();

program
  .name("wiki")
  .description("Wikibase — personal knowledge base for AI sessions")
  .version("0.1.0");

program.addCommand(addCommand);
program.addCommand(getCommand);
program.addCommand(searchCommand);
program.addCommand(listCommand);
program.addCommand(deleteCommand);
program.addCommand(updateCommand);
program.addCommand(mcpCommand);
program.addCommand(serveCommand);
program.addCommand(reindexCommand);
program.addCommand(exportCommand);
program.addCommand(migrateBlocksCommand);
program.addCommand(importMdCommand);
program.addCommand(exportMdCommand);
program.addCommand(instanceCommand);
program.addCommand(aiHowToCommand);

program.parseAsync().then(() => {
  // serve keeps the process alive via its child process; all other commands exit
  if (!process.argv.includes("serve")) process.exit(0);
});

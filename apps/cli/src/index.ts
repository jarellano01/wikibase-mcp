#!/usr/bin/env node
import { Command } from "commander";
import { addCommand } from "./commands/add.js";
import { getCommand } from "./commands/get.js";
import { searchCommand } from "./commands/search.js";
import { listCommand } from "./commands/list.js";
import { deleteCommand } from "./commands/delete.js";
import { updateCommand } from "./commands/update.js";
import { setupCommand } from "./commands/setup.js";
import { serveCommand } from "./commands/serve.js";
import { reindexCommand } from "./commands/reindex.js";
import { exportCommand } from "./commands/export.js";

const program = new Command();

program
  .name("wiki")
  .description("AI Wiki — personal knowledge base for AI sessions")
  .version("0.1.0");

program.addCommand(addCommand);
program.addCommand(getCommand);
program.addCommand(searchCommand);
program.addCommand(listCommand);
program.addCommand(deleteCommand);
program.addCommand(updateCommand);
program.addCommand(setupCommand);
program.addCommand(serveCommand);
program.addCommand(reindexCommand);
program.addCommand(exportCommand);

program.parseAsync().then(() => {
  // serve keeps the process alive via its child process; all other commands exit
  if (!process.argv.includes("serve")) process.exit(0);
});

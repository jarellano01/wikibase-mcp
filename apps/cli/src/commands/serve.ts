import { Command } from "commander";
import { spawn } from "child_process";
import { join } from "path";

export const serveCommand = new Command("serve")
  .description("Start the local web dashboard")
  .option("-p, --port <port>", "Port", "3001")
  .action((opts) => {
    // import.meta.dirname = apps/cli/dist/ → ../../server/dist/index.js
    const serverEntry = join(import.meta.dirname, "../../server/dist/index.js");
    console.log(`Starting web dashboard on http://localhost:${opts.port}`);

    const proc = spawn("node", [serverEntry], {
      stdio: "inherit",
      env: { ...process.env, PORT: opts.port },
    });

    proc.on("error", (err) => {
      console.error("Failed to start web dashboard:", err.message);
      process.exit(1);
    });
  });

import { Command } from "commander";
import { spawn } from "child_process";
import { join } from "path";
import { rmSync, existsSync } from "fs";

export const serveCommand = new Command("serve")
  .description("Start the local web dashboard")
  .option("-p, --port <port>", "Port", "3000")
  .action((opts) => {
    // import.meta.dirname = apps/cli/dist/ → ../../web = apps/web/
    const webDir = join(import.meta.dirname, "../../web");
    const nextCacheDir = join(webDir, ".next");
    if (existsSync(nextCacheDir)) rmSync(nextCacheDir, { recursive: true, force: true });
    console.log(`Starting web dashboard on http://localhost:${opts.port}`);

    const proc = spawn("pnpm", ["next", "dev", "--port", opts.port], {
      cwd: webDir,
      stdio: "inherit",
      shell: true,
      env: { ...process.env, PORT: opts.port },
    });

    proc.on("error", (err) => {
      console.error("Failed to start web dashboard:", err.message);
      process.exit(1);
    });
  });

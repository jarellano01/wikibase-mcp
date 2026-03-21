import { Command } from "commander";
import { execSync } from "child_process";
import { cpSync, existsSync, rmSync } from "fs";
import { join, resolve } from "path";

export const exportCommand = new Command("export")
  .description("Generate a static site snapshot and copy it to a directory")
  .argument("[outDir]", "Output directory", "./wiki-export")
  .action((outDir: string) => {
    const webDir = join(import.meta.dirname, "../../web");
    const builtOut = join(webDir, "out");
    const dest = resolve(outDir);

    console.log("Building static site...");
    try {
      execSync("pnpm next build", { cwd: webDir, stdio: "inherit" });
    } catch {
      console.error("Build failed.");
      process.exit(1);
    }

    if (!existsSync(builtOut)) {
      console.error("Build succeeded but no 'out' directory found.");
      process.exit(1);
    }

    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
    cpSync(builtOut, dest, { recursive: true });

    console.log(`\nStatic site exported to: ${dest}`);
    console.log("Serve it with: npx serve " + dest);
  });

import type { NextConfig } from "next";

const config: NextConfig = {
  output: "export",
  transpilePackages: ["@ai-wiki/db"],
webpack: (config) => {
    // Allow TypeScript source imports with .js extensions (Node ESM convention)
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default config;

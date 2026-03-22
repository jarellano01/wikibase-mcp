import type { NextConfig } from "next";

const config: NextConfig = {
  output: "export",
  transpilePackages: ["@ai-wiki/db"],
webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    // @huggingface/transformers uses native binaries — never bundle it
    config.externals = [
      ...(Array.isArray(config.externals) ? config.externals : []),
      "@huggingface/transformers",
    ];
    return config;
  },
};

export default config;

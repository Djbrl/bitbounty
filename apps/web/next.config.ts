import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Monorepo root, so Next doesn't guess it from a stray lockfile.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  // Workspace packages imported from TS source go here (e.g. "@bitbounty/core").
  transpilePackages: ["@bitbounty/core"],
  // packages/core is NodeNext TS source: its imports say "./types.js" for "./types.ts".
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;

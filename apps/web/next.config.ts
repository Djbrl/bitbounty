import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Monorepo root, so Next doesn't guess it from a stray lockfile.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  // Workspace packages imported from TS source go here (e.g. "@bitbounty/core").
  transpilePackages: [],
};

export default nextConfig;

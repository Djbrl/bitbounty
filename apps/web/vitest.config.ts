import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Next.js keeps tsconfig "jsx": "preserve"; tests need JSX compiled.
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  // Same "@/*" path alias as tsconfig.json, so files under app/ that use it can be tested.
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  // next-auth imports "next/server" without an extension; let Vite resolve it (W9 middleware test).
  test: { server: { deps: { inline: ["next-auth"] } } },
});

import { defineConfig } from "vitest/config";

// Next.js keeps tsconfig "jsx": "preserve"; tests need JSX compiled.
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  // next-auth imports "next/server" without an extension; let Vite resolve it (W9 middleware test).
  test: { server: { deps: { inline: ["next-auth"] } } },
});

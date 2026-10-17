import { defineConfig } from "vitest/config";

// Next.js keeps tsconfig "jsx": "preserve"; tests need JSX compiled.
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
});

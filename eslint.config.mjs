import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/next-env.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Webhook payloads and test assertions are untyped JSON; flag it, don't block the build.
      "@typescript-eslint/no-explicit-any": "warn",
      // `_name` and rest-sibling destructuring are the idiom for "drop this field".
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
      "no-irregular-whitespace": ["error", { skipStrings: true, skipTemplates: true, skipComments: true }],
    },
  },
  // Node scripts (fixtures generator and checker).
  { files: ["**/*.mjs", "**/*.cjs"], languageOptions: { globals: globals.node } },
);

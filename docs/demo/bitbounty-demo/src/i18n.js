import { readFileSync } from "node:fs";

const load = (lang) => JSON.parse(readFileSync(new URL(`../locales/${lang}.json`, import.meta.url), "utf8"));

/** Languages with a file in locales/. Add one by adding `locales/<code>.json`. */
export const LANGUAGES = ["en", "fr"];

const messages = Object.fromEntries(LANGUAGES.map((lang) => [lang, load(lang)]));

/** The message `key` in `lang`, with `{name}` placeholders filled. Falls back to English. */
export function t(lang, key, params = {}) {
  const text = messages[lang]?.[key] ?? messages.en[key];
  if (text === undefined) throw new Error(`unknown message: ${key}`);
  return text.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));
}

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { LANGUAGES, t } from "../src/i18n.js";

const dir = new URL("../locales/", import.meta.url);
const read = (file) => JSON.parse(readFileSync(new URL(file, dir), "utf8"));
const english = Object.keys(read("en.json")).sort();

for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  test(`${file} has every message of en.json, and only those`, () => {
    assert.deepEqual(Object.keys(read(file)).sort(), english);
  });

  test(`${file} is listed in LANGUAGES`, () => {
    assert.ok(LANGUAGES.includes(file.replace(/\.json$/, "")));
  });
}

test("fills placeholders", () => {
  assert.equal(t("en", "welcome", { name: "Awa" }), "Welcome, Awa!");
  assert.equal(t("fr", "welcome", { name: "Awa" }), "Bienvenue, Awa !");
});

test("falls back to English for an unknown language", () => {
  assert.equal(t("xx", "thanks"), "Thank you for contributing!");
});

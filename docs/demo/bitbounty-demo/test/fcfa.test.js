import assert from "node:assert/strict";
import { test } from "node:test";
import { formatSats, formatXof, groupThousands, satsToXof, xofToSats } from "../src/fcfa.js";

test("formats FCFA amounts with a space between thousands", () => {
  assert.equal(formatXof(500), "500 FCFA");
  assert.equal(formatXof(5000), "5 000 FCFA");
  assert.equal(formatXof(25000), "25 000 FCFA");
});

test("formats sats", () => {
  assert.equal(formatSats(16129), "16 129 sats");
});

test("keeps the sign of negative amounts", () => {
  assert.equal(groupThousands(-7500), "-7 500");
});

test("refuses amounts with decimals", () => {
  assert.throws(() => formatXof(10.5), TypeError);
});

test("converts FCFA to sats and back", () => {
  const rate = 62_000_000; // FCFA per bitcoin
  assert.equal(xofToSats(10000, rate), 16129);
  assert.equal(satsToXof(16129, rate), 10000);
});

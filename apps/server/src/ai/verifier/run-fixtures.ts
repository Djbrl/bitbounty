/**
 * `pnpm --filter @bitbounty/server verify:fixtures`
 * Runs the 5 fixtures through verify() and prints a table. Uses the real model when
 * ANTHROPIC_API_KEY is set (model: VERIFIER_MODEL or claude-sonnet-5-5), otherwise the
 * offline heuristic fake. Exit code 1 if any fixture gets an unexpected verdict.
 */
import { loadFixtures } from "./fixtures.js";
import { createVerifierClient, verify } from "./verify.js";

const client = createVerifierClient();
console.log(`verifier: ${client.name}${client.isFake ? " (no ANTHROPIC_API_KEY, offline fake)" : ""}\n`);

const rows: string[][] = [];
let failures = 0;
for (const fx of loadFixtures()) {
  const t0 = Date.now();
  const report = await verify(fx.input, { client });
  const ok = fx.expected.includes(report.verdict);
  if (!ok) failures++;
  rows.push([
    fx.file.replace(/\.json$/, ""),
    fx.expected.join("|"),
    report.verdict,
    ok ? "OK" : "MISMATCH",
    `${((Date.now() - t0) / 1000).toFixed(1)}s`,
    report.criteria.map((c) => (c.met ? "Y" : "n")).join(""),
    report.riskFlags.join("; ").slice(0, 70),
  ]);
}

const head = ["fixture", "expected", "got", "result", "time", "met", "risk flags"];
const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
const line = (r: string[]) => r.map((c, i) => c.padEnd(widths[i]!)).join(" | ");
console.log(line(head));
console.log(widths.map((w) => "-".repeat(w)).join("-|-"));
for (const r of rows) console.log(line(r));
console.log(`\n${rows.length - failures}/${rows.length} as expected`);
process.exitCode = failures === 0 ? 0 : 1;

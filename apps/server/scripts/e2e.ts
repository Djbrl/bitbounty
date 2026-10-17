/**
 * I2: plays the whole story, start to finish, N times in a row, each on an empty database.
 *   pnpm --filter @bitbounty/server e2e                       # offline fakes, 3 runs
 *   pnpm --filter @bitbounty/server e2e -- --sandbox          # real Bitnob sandbox (keys in ../../.env)
 *   options: --runs=3  --fund=ngn|lightning  --phone=+221…  --provider=wave|orange  --name="Awa Diop"  --amount=300
 * Sandbox defaults to naira funding (fully automatic with simulated deposits); Lightning needs
 * someone to pay the printed invoice. Exit code 1 on the first failed run.
 */
import { BitnobClient, readBitnobConfig } from "@bitbounty/bitnob";
import type { PayoutProvider } from "@bitbounty/core";
import { E2eError, runHappyPath } from "../src/e2e/harness.js";

const args = new Map(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, ...v] = a.slice(2).split("=");
      return [k!, v.length ? v.join("=") : "true"] as const;
    }),
);
const sandbox = args.has("sandbox");
const runs = Number(args.get("runs") ?? 3);
const fund = (args.get("fund") ?? (sandbox ? "ngn" : "lightning")) as "ngn" | "lightning";
const bitnob = sandbox ? new BitnobClient(readBitnobConfig()) : undefined;
const beneficiary = args.has("phone")
  ? {
      provider: (args.get("provider") ?? "wave") as PayoutProvider,
      phoneE164: args.get("phone")!,
      accountName: args.get("name") ?? "BitBounty Test",
      country: args.get("country") ?? "SN",
    }
  : undefined;

let green = 0;
for (let i = 1; i <= runs; i++) {
  console.log(`\n=== run ${i}/${runs}`);
  const t = Date.now();
  try {
    const r = await runHappyPath({
      bitnob,
      fund,
      beneficiary,
      amountXof: args.has("amount") ? Number(args.get("amount")) : undefined,
      log: (l) => console.log(l),
    });
    console.log(`  events: ${r.events.join(" → ")}`);
    console.log(`  GREEN in ${((Date.now() - t) / 1000).toFixed(1)} s`);
    green++;
  } catch (err) {
    console.log(`  RED: ${err instanceof Error ? err.message : err}`);
    if (err instanceof E2eError) console.log(`  events so far: ${(err.report.events ?? []).join(" → ")}`);
    break;
  }
}
console.log(`\n${green}/${runs} green${green === runs ? "" : " — FAILED"}`);
process.exit(green === runs ? 0 : 1);

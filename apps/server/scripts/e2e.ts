/**
 * I2: plays the whole story, start to finish, N times in a row, each on an empty database.
 *   pnpm --filter @bitbounty/server e2e                       # offline fakes, 3 runs
 *   pnpm --filter @bitbounty/server e2e -- --sandbox          # real Bitnob sandbox (keys in ../../.env)
 *   options: --runs=3  --fund=ngn|lightning  --address=awa@blink.sv  --amount=300
 * The payout goes over Lightning (B6) to --address. With --sandbox, Bitnob must have `send_lightning`
 * enabled on the account (our sandbox answers 403 FEATURE_NOT_ENABLED as of 2026-10-18).
 * Sandbox defaults to naira funding (fully automatic with simulated deposits); Lightning needs
 * someone to pay the printed invoice. Exit code 1 on the first failed run.
 *
 * I4: `--serve=8794` keeps the read API up on that port (the runs then share one database, so /live
 * shows them all) and `--pace=1500` waits that long after each step so /live animates:
 *   pnpm --filter @bitbounty/server e2e -- --fund=ngn --runs=2 --serve=8794 --pace=1500
 *   BITBOUNTY_API_URL=http://localhost:8794 pnpm --filter @bitbounty/web dev   # then open /live
 * Naira runs print the Lagos route /live shows and check that it adds up (a run fails if not).
 */
import { BitnobClient, readBitnobConfig } from "@bitbounty/bitnob";
import { routeChecks, type LiveRoute } from "../src/api/index.js";
import { createReadSide, E2eError, runHappyPath } from "../src/e2e/harness.js";

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
const lightningAddress = args.get("address");
const port = args.has("serve") ? Number(args.get("serve") === "true" ? 8787 : args.get("serve")) : null;
const readSide = port ? createReadSide() : undefined;

if (port && readSide) {
  const { serve } = await import("@hono/node-server");
  serve({ fetch: readSide.api.fetch, port });
  console.log(`Read API on http://localhost:${port}. Start the web with BITBOUNTY_API_URL=http://localhost:${port} and watch /live.`);
}

const showRoute = (route: LiveRoute | null) => {
  if (!route) return console.log("  Lagos route: not on /live");
  console.log(`  Lagos route on /live: ${JSON.stringify(route)}`);
  for (const c of routeChecks(route)) console.log(`    ${c.ok ? "✓" : "✗"} ${c.text}`);
};

let green = 0;
for (let i = 1; i <= runs; i++) {
  console.log(`\n=== run ${i}/${runs}`);
  const t = Date.now();
  try {
    const r = await runHappyPath({
      bitnob,
      fund,
      lightningAddress,
      amountXof: args.has("amount") ? Number(args.get("amount")) : undefined,
      log: (l) => console.log(l),
      readSide,
      stepDelayMs: args.has("pace") ? Number(args.get("pace")) : 0,
    });
    console.log(`  events: ${r.events.join(" → ")}`);
    if (fund === "ngn") {
      showRoute(r.route);
      if (!r.route || routeChecks(r.route).some((c) => !c.ok)) throw new Error("the Lagos route on /live is missing or doesn't add up");
    }
    console.log(`  GREEN in ${((Date.now() - t) / 1000).toFixed(1)} s`);
    green++;
  } catch (err) {
    console.log(`  RED: ${err instanceof Error ? err.message : err}`);
    if (err instanceof E2eError) console.log(`  events so far: ${(err.report.events ?? []).join(" → ")}`);
    break;
  }
}
console.log(`\n${green}/${runs} green${green === runs ? "" : " — FAILED"}`);
if (port && green === runs) console.log(`Still serving on http://localhost:${port} · Ctrl+C to stop`);
else process.exit(green === runs ? 0 : 1);

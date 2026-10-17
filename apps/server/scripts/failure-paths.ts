// I3: pnpm --filter @bitbounty/server demo:failures [-- --serve=8787]
// Plays the two failure paths (payout retried, claim expired) with the real modules and prints what
// GitHub and the web show. With --serve, keeps the read API up so the web (BITBOUNTY_API_URL) displays them.
import { claimExpiry, FailureWorld, payoutRetry, type ScenarioReport } from "../src/e2e/failure-paths.js";

const serveArg = process.argv.find((a) => a.startsWith("--serve"));
const port = serveArg ? Number(serveArg.split("=")[1] ?? 8787) : null;

const show = (r: ScenarioReport) => {
  console.log(`\n=== ${r.scenario}: ${r.repo} · bounty ${r.bountyId}`);
  console.log("GitHub status comment (final):\n" + r.statusComment.replace(/^<!--.*-->\n?/m, "").split("\n").map((l) => `  │ ${l}`).join("\n"));
  for (const n of r.notes) console.log(`Bot note: ${n}`);
  console.log(`Labels: ${r.labels.join(", ")}`);
  console.log(`Web (/b/${r.bountyId}): ${r.web.status} · timeline ${r.web.timeline.join(" → ")}`);
};

try {
  const world = new FailureWorld({
    // Slow enough to watch on /live, fast enough for a demo.
    claimTtlMs: port ? 20_000 : 300,
    retryDelayMs: port ? 4_000 : 300,
    log: (l) => console.log(l),
  });
  await world.start();
  if (port) {
    await world.serve(port);
    console.log(`Read API on http://localhost:${port}. Start the web with BITBOUNTY_API_URL=http://localhost:${port} and watch /live.\n`);
  }
  const payout = await payoutRetry(world);
  const claim = await claimExpiry(world);
  show(payout);
  show(claim);
  if (port) {
    console.log(`\nStill serving on http://localhost:${port}. Open on the web:`);
    console.log(`  /b/${payout.bountyId}   (payout failed then retried, paid)`);
    console.log(`  /b/${claim.bountyId}   (claim expired, claimed again)`);
    console.log("  /live, /  · Ctrl+C to stop");
  } else {
    world.stop();
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

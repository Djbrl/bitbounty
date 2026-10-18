import { BitnobClient, readBitnobConfig } from "@bitbounty/bitnob";
import { createDb } from "@bitbounty/db";
import { Hono } from "hono";
import { ActivityLog, readApiRoutes } from "./api/index.js";
import { DrizzleFundingReader, mergeFundings } from "./api/drizzle-read.js";
import { bitnobWebhookRoutes } from "./bitnob/webhook.js";
import { bitnobProxyRoutes } from "./dev/bitnob-proxy.js";
import { GithubDispatcher } from "./github/dispatcher.js";
import { DrizzleEventStore } from "./github/drizzle-event-store.js";
import { InMemoryEventStore, type EventStore } from "./github/event-store.js";
import { githubWebhookRoutes } from "./github/webhook.js";
import { InMemoryEventBus, defaultPrDeps, registerPrHandlers } from "./github/pr/index.js";
import { InMemoryBountyRepo, type BountyRepo } from "./bounties/repo.js";
import { DrizzleBountyRepo } from "./bounties/drizzle-repo.js";
import { createGithubApp } from "./github/app-client.js";
import { installationWriterFactory, registerCommentWiring, syncIssue } from "./github/wiring/index.js";
import {
  appGithubForRepo,
  ClaimTimers,
  devFundRoutes,
  InMemoryClaimScheduler,
  readClaimTtlMs,
  sweepIntervalMs,
} from "./github/claims/index.js";
import { defaultCheckRunDeps, registerCheckRun } from "./ai/check-run/index.js";
import { backlogRoutes } from "./ai/backlog/index.js";
import { agentRoutes, agentsFromEnv, AgentService, DrizzleAgentSpending, ListAgentSpending, StaticAgentRegistry } from "./agents/index.js";
import {
  applyFundingPaid,
  BitnobFunderCustomers,
  BitnobRates,
  InMemoryFundingStore,
  LightningFunding,
} from "./funding/index.js";
import {
  DrizzlePayoutStore,
  HttpLnurlResolver,
  InMemoryPayoutStore,
  PayoutService,
  readLightningNetwork,
  type PayoutStore,
} from "./payouts/index.js";
import { payeeFromAccounts, readObjectionWindowMs, readPayoutAccounts, Settlement, statusExtras } from "./settlement/index.js";
import type { Bounty } from "@bitbounty/core";

export const app = new Hono();

app.get("/", (c) => c.json({ name: "bitbounty-server", message: "hello" }));

app.get("/health", (c) => c.json({ status: "ok" }));

// A3: "Price my backlog" suggestions for a repo (Claude, or the offline heuristic without ANTHROPIC_API_KEY).
app.route("/", backlogRoutes());

// DEV ONLY (F7): /dev/bitnob/* forwards teammates' Bitnob sandbox calls, signed with this server's keys.
// Not mounted (404) unless DEV_PROXY_TOKEN is set. See src/dev/bitnob-proxy.ts and docs/bitnob-api.md.
const devProxyToken = process.env.DEV_PROXY_TOKEN?.trim();
if (devProxyToken) {
  const hasKeys = Boolean(process.env.BITNOB_CLIENT_ID?.trim() && process.env.BITNOB_CLIENT_SECRET?.trim());
  // The server signs itself: a BITNOB_PROXY_TOKEN in the server's own env is ignored here.
  const env = { ...process.env, BITNOB_PROXY_TOKEN: "" };
  app.route("/", bitnobProxyRoutes({ token: devProxyToken, client: hasKeys ? new BitnobClient(readBitnobConfig(env)) : null }));
  console.log(`[dev-proxy] /dev/bitnob/* enabled${hasKeys ? "" : " (no Bitnob keys: calls answer 503)"}`);
}

/** G3, G4 and A2 register their handlers here: `githubDispatcher.on("issue_comment", …)`. */
export const githubDispatcher = new GithubDispatcher();

/** Postgres when DATABASE_URL is set (Docker, Railway), otherwise in memory (tests, offline demo). */
export const database = process.env.DATABASE_URL ? createDb(process.env.DATABASE_URL) : null;
/** Inbound webhook log + dedupe, shared by /webhooks/github and /webhooks/bitnob (`source` tells them apart). */
export const eventStore: EventStore = database ? new DrizzleEventStore(database.db) : new InMemoryEventStore();
/** Bounties and claims, shared by G3 (comments), G4 (PRs) and A2 (checks). */
export const bountyRepo: BountyRepo = database ? new DrizzleBountyRepo(database.db) : new InMemoryBountyRepo();
console.log(
  database
    ? "[db] Postgres (DATABASE_URL): DrizzleEventStore + DrizzleBountyRepo"
    : "[db] DATABASE_URL not set: InMemoryEventStore + InMemoryBountyRepo",
);

/** Internal events (`pr.linked`, `pr.merged`, …). In-memory until pg-boss; subscribe with `eventBus.subscribe(type, fn)`. */
export const eventBus = new InMemoryEventBus();

// G4: pull_request opened/edited/synchronize/reopened → pr.linked; closed+merged → pr.merged.
const prDeps = defaultPrDeps(eventBus, process.env, bountyRepo);
registerPrHandlers(githubDispatcher, prDeps);

/** Re-renders a bounty's status comment + label from outside a webhook (set when the GitHub App is configured). */
let statusSync: ((bounty: Bounty) => Promise<void>) | undefined;
/** Set once the GitHub App is configured: lets A4 post the bot's status comment for agent bounties. */
let githubForRepo: ReturnType<typeof appGithubForRepo> | undefined;

// G3: issue_comment.created → command → transition() → status comment edited in place + label.
// G5: claim timers (assign on /claim, expire after CLAIM_TTL_MINUTES or 72 h, /extend once).
if (process.env.GITHUB_APP_ID && process.env.GITHUB_PRIVATE_KEY && process.env.GITHUB_WEBHOOK_SECRET) {
  const githubApp = createGithubApp();
  const botSettings = {
    baseUrl: process.env.WEB_BASE_URL || "https://bitbounty-app.vercel.app",
    lang: (process.env.BOT_LANG === "fr" ? "fr" : "en") as "fr" | "en",
    botLogin: process.env.GITHUB_BOT_LOGIN || undefined,
  };
  const claimTtlMs = readClaimTtlMs();
  const github = appGithubForRepo(githubApp);
  githubForRepo = github;
  const claimTimers: ClaimTimers = new ClaimTimers({
    repo: bountyRepo,
    bus: eventBus,
    scheduler: new InMemoryClaimScheduler({ pending: () => claimTimers.pending(), sweepMs: sweepIntervalMs(claimTtlMs) }),
    github,
    ttlMs: claimTtlMs,
    ...botSettings,
  });
  registerCommentWiring(githubDispatcher, {
    repo: bountyRepo,
    bus: eventBus,
    writerFor: installationWriterFactory(githubApp),
    claimTtlMs,
    claims: claimTimers,
    ...botSettings,
  });
  void claimTimers.start();
  statusSync = async (bounty) => {
    const { writer } = await github(bounty.repoFullName);
    // I3: claim, PR and payout attempt / last error / receipt, so failures read cleanly on GitHub.
    const extras = await statusExtras(bounty, { repo: bountyRepo, payouts: payoutStore });
    await syncIssue(bounty, { writer, repo: bountyRepo, extras, ...botSettings });
  };
  // DEV ONLY: POST /dev/fund marks a bounty paid until Bitnob funding is wired (see github/claims/dev-fund.ts).
  if (process.env.DEV_HOOK_TOKEN) {
    app.route("/", devFundRoutes({ token: process.env.DEV_HOOK_TOKEN, repo: bountyRepo, bus: eventBus, github, ...botSettings }));
  }
}

// A4: agents fund bounties through /v1 (and packages/mcp) with a `bb_` key, inside their owner's budget.
const agents = agentsFromEnv(process.env.BITBOUNTY_AGENTS);
app.route(
  "/",
  agentRoutes(
    new StaticAgentRegistry(agents),
    new AgentService({
      repo: bountyRepo,
      bus: eventBus,
      spending: database
        ? new DrizzleAgentSpending(database.db)
        : new ListAgentSpending(() => (bountyRepo instanceof InMemoryBountyRepo ? bountyRepo.all() : [])),
      baseUrl: process.env.WEB_BASE_URL || "https://bitbounty-app.vercel.app",
      github: githubForRepo,
      lang: process.env.BOT_LANG === "fr" ? "fr" : "en",
      botLogin: process.env.GITHUB_BOT_LOGIN || undefined,
    }),
  ),
);
if (agents.length) console.log(`[agents] ${agents.length} agent key(s) loaded from BITBOUNTY_AGENTS`);

// A2: pull_request opened/synchronize/reopened on a funded bounty → "BitBounty verification" check run + verify.done.
const checkRunDeps = defaultCheckRunDeps(prDeps.bounties, eventBus);
if (checkRunDeps) registerCheckRun(githubDispatcher, checkRunDeps);

const secret = process.env.GITHUB_WEBHOOK_SECRET;
if (secret) {
  app.route("/", githubWebhookRoutes({ secret, store: eventStore, dispatcher: githubDispatcher }));
} else {
  app.post("/webhooks/github", (c) => c.json({ error: "GITHUB_WEBHOOK_SECRET is not set" }, 503));
}

/** B2 (payouts) and B4 (NGN deposits) register here: `bitnobDispatcher.on("payouts.withdrawal.success", …)`. */
export const bitnobDispatcher = new GithubDispatcher();

const bitnobSecret = process.env.BITNOB_WEBHOOK_SECRET;
if (bitnobSecret) {
  app.route(
    "/",
    // Same store as /webhooks/github: Postgres (DrizzleEventStore) when DATABASE_URL is set.
    bitnobWebhookRoutes({ secret: bitnobSecret, store: eventStore, dispatcher: bitnobDispatcher }),
  );
} else {
  app.post("/webhooks/bitnob", (c) => c.json({ error: "BITNOB_WEBHOOK_SECRET is not set" }, 503));
}

// B1: Lightning funding. Amount and status come from the shared bountyRepo; a paid invoice moves the
// bounty to `funded` and publishes funding.paid (at least once, via the funding outbox).
// In-memory FundingStore until the Drizzle one lands (see src/funding/README.md). No HTTP route yet (W3).
/** Fundings (B1), shared with the read API (I1) so /b/:id shows them. In memory until DrizzleFundingStore lands. */
export const fundingStore = new InMemoryFundingStore();

export const lightningFunding =
  process.env.BITNOB_CLIENT_ID && process.env.BITNOB_CLIENT_SECRET
    ? (() => {
        const client = new BitnobClient(readBitnobConfig());
        const lf = new LightningFunding({
          client,
          store: fundingStore,
          rates: new BitnobRates(client),
          customers: new BitnobFunderCustomers(client),
          bounties: bountyRepo,
          emit: applyFundingPaid(bountyRepo, eventBus),
        });
        lf.startPolling();
        return lf;
      })()
    : null;

// I2: settlement, the glue after the PR. verify.done → verdict on the bounty; merge or /pay that
// verified it → B6 Lightning payout after OBJECTION_WINDOW_MINUTES (0 by default, the demo); payout
// events → paying / paid / payout_failed; funding, PR and payout events re-render the status comment.
// Payouts need Bitnob keys; where to pay (a Lightning Address per GitHub login) comes from
// PAYOUT_ACCOUNTS until W4/B7 store accounts.
/** B6: payouts in Postgres when DATABASE_URL is set (a restart resumes them), else in memory. */
export const payoutStore: PayoutStore = database ? new DrizzlePayoutStore(database.db) : new InMemoryPayoutStore();
// Validated at boot: a typo refuses to start instead of accepting invoices for the wrong chain.
const lightningNetwork = readLightningNetwork();
const payoutAccounts = readPayoutAccounts();
let payoutService: PayoutService | null = null;
export const settlement = new Settlement({
  repo: bountyRepo,
  bus: eventBus,
  startPayout: (req) => {
    if (!payoutService) throw new Error("payouts need BITNOB_CLIENT_ID / BITNOB_CLIENT_SECRET");
    return payoutService.start(req);
  },
  sync: (bounty) => statusSync?.(bounty) ?? Promise.resolve(),
  // Validated at boot: a bad value refuses to start instead of paying at once.
  objectionMs: readObjectionWindowMs(),
}).register();

if (process.env.BITNOB_CLIENT_ID && process.env.BITNOB_CLIENT_SECRET) {
  const client = new BitnobClient(readBitnobConfig());
  payoutService = new PayoutService({
    rails: client,
    resolver: new HttpLnurlResolver({ network: lightningNetwork }),
    rates: new BitnobRates(client),
    store: payoutStore,
    emit: settlement.applyPayoutEvent,
    getPayee: payeeFromAccounts(payoutAccounts),
    customerId: process.env.BITNOB_PAYOUT_CUSTOMER_ID?.trim() || undefined,
  });
  payoutService.register(bitnobDispatcher);
  console.log(`[payouts] Lightning payouts on ${lightningNetwork}, ${payoutAccounts.size} account(s) in PAYOUT_ACCOUNTS, store ${database ? "Postgres" : "in memory"}`);
}

/**
 * B6: resumes interrupted payouts and starts polling Bitnob. Called by index.ts **after** the
 * migrations ran (the payouts table may just have gained its Lightning columns), not at import.
 */
export function startPayouts(): void {
  if (!payoutService) return;
  void payoutService.resume().catch((err) => console.error(`[payouts] resume failed: ${err instanceof Error ? err.message : err}`));
  payoutService.startPolling();
}
// I1: read API for the web pages (board, bounties, dashboard, profiles, receipts, /me, live SSE, funding).
// Timelines and the live feed come from the internal events (ActivityLog, in memory).
export const activityLog = new ActivityLog(bountyRepo).attach(eventBus);
app.route(
  "/",
  readApiRoutes({
    repo: bountyRepo,
    activity: activityLog,
    // Live fundings from memory, plus whatever is in Postgres (seed, later the Drizzle stores).
    fundings: database ? mergeFundings(fundingStore, new DrizzleFundingReader(database.db)) : fundingStore,
    // B6: the payout service's store (Postgres when DATABASE_URL is set, so the seed shows too).
    payouts: database || payoutService ? payoutStore : undefined,
    lightning: lightningFunding,
    internalToken: process.env.INTERNAL_API_TOKEN?.trim() || undefined,
  }),
);

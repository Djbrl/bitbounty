import { createDb } from "@bitbounty/db";
import { Hono } from "hono";
import { bitnobWebhookRoutes } from "./bitnob/webhook.js";
import { GithubDispatcher } from "./github/dispatcher.js";
import { DrizzleEventStore } from "./github/drizzle-event-store.js";
import { InMemoryEventStore, type EventStore } from "./github/event-store.js";
import { githubWebhookRoutes } from "./github/webhook.js";
import { InMemoryEventBus, defaultPrDeps, registerPrHandlers } from "./github/pr/index.js";
import { InMemoryBountyRepo, type BountyRepo } from "./bounties/repo.js";
import { DrizzleBountyRepo } from "./bounties/drizzle-repo.js";
import { createGithubApp } from "./github/app-client.js";
import { installationWriterFactory, registerCommentWiring } from "./github/wiring/index.js";
import {
  appGithubForRepo,
  ClaimTimers,
  devFundRoutes,
  InMemoryClaimScheduler,
  readClaimTtlMs,
  sweepIntervalMs,
} from "./github/claims/index.js";
import { defaultCheckRunDeps, registerCheckRun } from "./ai/check-run/index.js";

export const app = new Hono();

app.get("/", (c) => c.json({ name: "bitbounty-server", message: "hello" }));

app.get("/health", (c) => c.json({ status: "ok" }));

/** G3, G4 and A2 register their handlers here: `githubDispatcher.on("issue_comment", …)`. */
export const githubDispatcher = new GithubDispatcher();

/** Postgres when DATABASE_URL is set (Docker, Railway), otherwise in memory (tests, offline demo). */
export const database = process.env.DATABASE_URL ? createDb(process.env.DATABASE_URL) : null;
const store: EventStore = database ? new DrizzleEventStore(database.db) : new InMemoryEventStore();
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
  // DEV ONLY: POST /dev/fund marks a bounty paid until Bitnob funding is wired (see github/claims/dev-fund.ts).
  if (process.env.DEV_HOOK_TOKEN) {
    app.route("/", devFundRoutes({ token: process.env.DEV_HOOK_TOKEN, repo: bountyRepo, bus: eventBus, github, ...botSettings }));
  }
}

// A2: pull_request opened/synchronize/reopened on a funded bounty → "BitBounty verification" check run + verify.done.
const checkRunDeps = defaultCheckRunDeps(prDeps.bounties, eventBus);
if (checkRunDeps) registerCheckRun(githubDispatcher, checkRunDeps);

const secret = process.env.GITHUB_WEBHOOK_SECRET;
if (secret) {
  app.route("/", githubWebhookRoutes({ secret, store, dispatcher: githubDispatcher }));
} else {
  app.post("/webhooks/github", (c) => c.json({ error: "GITHUB_WEBHOOK_SECRET is not set" }, 503));
}

/** B2 (payouts) and B4 (NGN deposits) register here: `bitnobDispatcher.on("payouts.withdrawal.success", …)`. */
export const bitnobDispatcher = new GithubDispatcher();

const bitnobSecret = process.env.BITNOB_WEBHOOK_SECRET;
if (bitnobSecret) {
  app.route(
    "/",
    bitnobWebhookRoutes({ secret: bitnobSecret, store: new InMemoryEventStore(), dispatcher: bitnobDispatcher }),
  );
} else {
  app.post("/webhooks/bitnob", (c) => c.json({ error: "BITNOB_WEBHOOK_SECRET is not set" }, 503));
}

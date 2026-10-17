import { Hono } from "hono";
import { GithubDispatcher } from "./github/dispatcher.js";
import { InMemoryEventStore } from "./github/event-store.js";
import { githubWebhookRoutes } from "./github/webhook.js";
import { InMemoryEventBus, defaultPrDeps, registerPrHandlers } from "./github/pr/index.js";
import { createGithubApp } from "./github/app-client.js";
import { installationWriterFactory, registerCommentWiring } from "./github/wiring/index.js";
import { InMemoryBountyRepo } from "./bounties/repo.js";

export const app = new Hono();

app.get("/", (c) => c.json({ name: "bitbounty-server", message: "hello" }));

app.get("/health", (c) => c.json({ status: "ok" }));

/** G3, G4 and A2 register their handlers here: `githubDispatcher.on("issue_comment", …)`. */
export const githubDispatcher = new GithubDispatcher();

/** Internal events (`pr.linked`, `pr.merged`, …). In-memory until pg-boss; subscribe with `eventBus.subscribe(type, fn)`. */
export const eventBus = new InMemoryEventBus();

/** Bounties and claims, shared by G3 (comments) and G4 (PRs). In-memory until F3's DB lands. */
export const bountyRepo = new InMemoryBountyRepo();

// G4: pull_request opened/edited/synchronize/reopened → pr.linked; closed+merged → pr.merged.
registerPrHandlers(githubDispatcher, { ...defaultPrDeps(eventBus), bounties: bountyRepo });

// G3: issue_comment.created → command → transition() → status comment edited in place + label.
if (process.env.GITHUB_APP_ID && process.env.GITHUB_PRIVATE_KEY && process.env.GITHUB_WEBHOOK_SECRET) {
  registerCommentWiring(githubDispatcher, {
    repo: bountyRepo,
    bus: eventBus,
    writerFor: installationWriterFactory(createGithubApp()),
    baseUrl: process.env.WEB_BASE_URL || "https://bitbounty-app.vercel.app",
    lang: process.env.BOT_LANG === "fr" ? "fr" : "en",
    botLogin: process.env.GITHUB_BOT_LOGIN || undefined,
  });
}

// In-memory store until F3 lands; then swap in DrizzleEventStore (see docs/github-app.md).
const secret = process.env.GITHUB_WEBHOOK_SECRET;
if (secret) {
  app.route("/", githubWebhookRoutes({ secret, store: new InMemoryEventStore(), dispatcher: githubDispatcher }));
} else {
  app.post("/webhooks/github", (c) => c.json({ error: "GITHUB_WEBHOOK_SECRET is not set" }, 503));
}

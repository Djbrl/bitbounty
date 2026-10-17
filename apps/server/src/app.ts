import { Hono } from "hono";
import { bitnobWebhookRoutes } from "./bitnob/webhook.js";
import { GithubDispatcher } from "./github/dispatcher.js";
import { InMemoryEventStore } from "./github/event-store.js";
import { githubWebhookRoutes } from "./github/webhook.js";

export const app = new Hono();

app.get("/", (c) => c.json({ name: "bitbounty-server", message: "hello" }));

app.get("/health", (c) => c.json({ status: "ok" }));

/** G3, G4 and A2 register their handlers here: `githubDispatcher.on("issue_comment", …)`. */
export const githubDispatcher = new GithubDispatcher();

// In-memory store until F3 lands; then swap in DrizzleEventStore (see docs/github-app.md).
const secret = process.env.GITHUB_WEBHOOK_SECRET;
if (secret) {
  app.route("/", githubWebhookRoutes({ secret, store: new InMemoryEventStore(), dispatcher: githubDispatcher }));
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

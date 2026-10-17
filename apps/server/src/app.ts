import { Hono } from "hono";
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

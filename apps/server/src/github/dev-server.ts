/**
 * Standalone webhook receiver for local testing before the full server (F1) is wired:
 *   GITHUB_WEBHOOK_SECRET=... npm run dev:webhook   (port 3001 by default)
 * Uses the in-memory store and logs every accepted event. See docs/github-app.md.
 */
import { serve } from "@hono/node-server";
import { GithubDispatcher } from "./dispatcher.js";
import { InMemoryEventStore } from "./event-store.js";
import { githubWebhookRoutes } from "./webhook.js";

const secret = process.env.GITHUB_WEBHOOK_SECRET;
if (!secret) {
  console.error("Set GITHUB_WEBHOOK_SECRET (same value as in the GitHub App settings).");
  process.exit(1);
}
const port = Number(process.env.PORT ?? 3001);

const store = new InMemoryEventStore();
const dispatcher = new GithubDispatcher().on("*", (e) => {
  const extra = e.type === "issue_comment" ? ` "${(e.payload as any).comment?.body}"` : "";
  console.info(
    `[github] #${e.id} ${e.type}${e.action ? "." + e.action : ""} ${e.repo ?? "-"} inst=${e.installationId ?? "-"} delivery=${e.externalId}${extra}`,
  );
});

serve({ fetch: githubWebhookRoutes({ secret, store, dispatcher }).fetch, port });
console.info(`GitHub webhook receiver on http://localhost:${port}/webhooks/github`);

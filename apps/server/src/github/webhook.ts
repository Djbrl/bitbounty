import { Hono } from "hono";
import type { GithubDispatcher } from "./dispatcher.js";
import type { EventStore, NewStoredEvent, StoredEvent } from "./event-store.js";
import { verifySignature } from "./signature.js";

export interface GithubWebhookOptions {
  /** GITHUB_WEBHOOK_SECRET */
  secret: string;
  store: EventStore;
  dispatcher: GithubDispatcher;
  log?: Pick<Console, "info" | "warn" | "error">;
}

type Json = Record<string, any>;

/** Pulls the indexed columns out of a GitHub payload. */
export function toNewEvent(
  deliveryId: string,
  eventName: string,
  payload: Json,
  receivedAt = new Date(),
): NewStoredEvent {
  return {
    source: "github",
    externalId: deliveryId,
    type: eventName,
    action: typeof payload.action === "string" ? payload.action : null,
    repo: typeof payload.repository?.full_name === "string" ? payload.repository.full_name : null,
    installationId: typeof payload.installation?.id === "number" ? payload.installation.id : null,
    payload,
    receivedAt,
  };
}

/**
 * Mount with `app.route("/", githubWebhookRoutes(opts))` → `POST /webhooks/github`.
 *
 * 401 bad/missing signature · 400 missing headers or invalid JSON ·
 * 200 stored + dispatched · 200 `{duplicate:true}` on redelivery of a handled event ·
 * 500 if a handler threw (event kept as `failed`; a GitHub redelivery retries it).
 */
export function githubWebhookRoutes(opts: GithubWebhookOptions) {
  const { secret, store, dispatcher, log = console } = opts;
  if (!secret) throw new Error("GITHUB_WEBHOOK_SECRET is required");
  const app = new Hono();

  app.post("/webhooks/github", async (c) => {
    const raw = Buffer.from(await c.req.arrayBuffer());
    if (!verifySignature(secret, raw, c.req.header("x-hub-signature-256"))) {
      log.warn("[github] rejected webhook: bad or missing signature");
      return c.json({ error: "invalid signature" }, 401);
    }

    const eventName = c.req.header("x-github-event");
    const deliveryId = c.req.header("x-github-delivery");
    if (!eventName || !deliveryId) {
      return c.json({ error: "missing X-GitHub-Event or X-GitHub-Delivery" }, 400);
    }

    let payload: Json;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }

    const { inserted, event } = await store.insert(toNewEvent(deliveryId, eventName, payload));
    if (!inserted && event.status !== "failed") {
      log.info(`[github] duplicate delivery ${deliveryId} (${eventName}), skipped`);
      return c.json({ ok: true, duplicate: true, id: event.id });
    }

    const error = await runDispatch(dispatcher, event);
    await store.markDone(event.id, error);
    if (error) {
      log.error(`[github] handler failed for ${deliveryId} (${eventName}): ${error}`);
      return c.json({ ok: false, error: "handler failed", id: event.id }, 500);
    }
    return c.json({ ok: true, id: event.id });
  });

  return app;
}

async function runDispatch(dispatcher: GithubDispatcher, event: StoredEvent) {
  try {
    await dispatcher.dispatch(event);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

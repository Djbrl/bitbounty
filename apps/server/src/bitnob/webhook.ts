import { Hono } from "hono";
import type { GithubDispatcher } from "../github/dispatcher.js";
import type { EventStore, NewStoredEvent, StoredEvent } from "../github/event-store.js";
import { parseEnvelope, type BitnobEnvelope } from "./events.js";
import { verifyBitnobSignature } from "./signature.js";

export interface BitnobWebhookOptions {
  /** BITNOB_WEBHOOK_SECRET */
  secret: string;
  /** Same store as GitHub; rows get `source = "bitnob"`. */
  store: EventStore;
  /**
   * Keyed on the Bitnob event name: `dispatcher.on("payouts.withdrawal.success", …)`.
   * The handler gets the stored event; `toPayoutUpdate(parseEnvelope(e.payload)!)` reads it.
   */
  dispatcher: GithubDispatcher;
  log?: Pick<Console, "info" | "warn" | "error">;
}

export function toNewBitnobEvent(env: BitnobEnvelope, payload: unknown, receivedAt = new Date()): NewStoredEvent {
  return {
    source: "bitnob",
    externalId: env.id,
    type: env.type,
    action: null,
    repo: null,
    installationId: null,
    payload,
    receivedAt,
  };
}

/**
 * Mount with `app.route("/", bitnobWebhookRoutes(opts))` → `POST /webhooks/bitnob`.
 *
 * 401 bad/missing signature · 400 invalid JSON or no event id/name ·
 * 200 stored + dispatched · 200 `{duplicate:true}` on redelivery of a handled event ·
 * 500 if a handler threw (event kept as `failed`; Bitnob retries non-200 3 times).
 */
export function bitnobWebhookRoutes(opts: BitnobWebhookOptions) {
  const { secret, store, dispatcher, log = console } = opts;
  if (!secret) throw new Error("BITNOB_WEBHOOK_SECRET is required");
  const app = new Hono();

  app.post("/webhooks/bitnob", async (c) => {
    const raw = Buffer.from(await c.req.arrayBuffer());
    if (!verifyBitnobSignature(secret, raw, c.req.header("x-bitnob-signature"))) {
      log.warn("[bitnob] rejected webhook: bad or missing signature");
      return c.json({ error: "invalid signature" }, 401);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }
    const env = parseEnvelope(payload);
    if (!env) return c.json({ error: "missing event id or event name" }, 400);

    const { inserted, event } = await store.insert(toNewBitnobEvent(env, payload));
    if (!inserted && event.status !== "failed") {
      log.info(`[bitnob] duplicate event ${env.id} (${env.type}), skipped`);
      return c.json({ ok: true, duplicate: true, id: event.id });
    }

    const error = await runDispatch(dispatcher, event);
    await store.markDone(event.id, error);
    if (error) {
      log.error(`[bitnob] handler failed for ${env.id} (${env.type}): ${error}`);
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

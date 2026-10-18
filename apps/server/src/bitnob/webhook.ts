import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
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
  /** Max request body in bytes, checked before the signature. Default 256 KiB (Bitnob events are a few KiB). */
  maxBodyBytes?: number;
}

export const DEFAULT_MAX_BODY_BYTES = 256 * 1024;

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
 * 413 body over `maxBodyBytes` · 401 bad/missing signature · 400 invalid JSON or no event id/name ·
 * 200 stored + dispatched · 200 `{duplicate:true}` on redelivery of a handled event ·
 * 500 if a handler threw (event kept as `failed`; Bitnob retries non-200 3 times).
 */
export function bitnobWebhookRoutes(opts: BitnobWebhookOptions) {
  const { secret, store, dispatcher, log = console, maxBodyBytes = DEFAULT_MAX_BODY_BYTES } = opts;
  if (!secret) throw new Error("BITNOB_WEBHOOK_SECRET is required");
  const app = new Hono();

  const limit = bodyLimit({
    maxSize: maxBodyBytes,
    onError: (c) => c.json({ error: "payload too large" }, 413),
  });

  app.post("/webhooks/bitnob", limit, async (c) => {
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

    // If the process dies between insert() and markDone(), the row stays `received` and a redelivery
    // is answered as a duplicate below, so it is NOT re-dispatched from here. Such rows are recovered by
    // polling: B2 polls `GET /api/payouts/:id` for payouts not yet terminal and feeds `toPayoutOutcome()`
    // to the same handler; deposits are reconciled the same way from `GET /api/transactions`.
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

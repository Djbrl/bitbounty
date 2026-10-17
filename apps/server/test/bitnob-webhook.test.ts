import { describe, expect, it, vi } from "vitest";
import {
  bitnobWebhookRoutes,
  parseEnvelope,
  signBitnobPayload,
  toDepositUpdate,
  toPayoutOutcome,
  toPayoutUpdate,
  verifyBitnobSignature,
} from "../src/bitnob/index.js";
import { GithubDispatcher } from "../src/github/dispatcher.js";
import { InMemoryEventStore, type StoredEvent } from "../src/github/event-store.js";

const SECRET = "test-bitnob-webhook-secret";

/** From the v2 OpenAPI spec example. */
const success = {
  event: "payouts.withdrawal.success",
  event_id: "d9c4758b-5e93-4cdf-bb12-3fa474865aaa",
  data: {
    id: "019f812d-ed2c-7f17-a2e9-12435e670813",
    quote_id: "QT2_21434859",
    company_id: "c1",
    reference: "pay-b1-1",
    status: "success",
    from_asset: "usdt",
    to_currency: "xof",
    amount: "16.5",
    settlement_amount: "10000",
    fees: "0",
    created_at: "2026-10-17T18:00:00Z",
    updated_at: "2026-10-17T18:00:30Z",
  },
};
const processing = {
  ...success,
  event: "payouts.processing",
  event_id: "11111111-1111-4111-8111-111111111111",
  data: { ...success.data, status: "processing" },
};
const deposit = {
  event: "virtual_account.deposit.success",
  eventId: "dep-1",
  data: { virtual_account_id: "va1", amount: "100000", currency: "NGN", reference: "sbx-dep-1" },
};

function setup() {
  const store = new InMemoryEventStore();
  const dispatcher = new GithubDispatcher();
  const seen: StoredEvent[] = [];
  dispatcher.on("*", (e) => {
    seen.push(e);
  });
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const app = bitnobWebhookRoutes({ secret: SECRET, store, dispatcher, log });
  const post = (body: string, signature: string | undefined = signBitnobPayload(SECRET, body)) =>
    app.request("/webhooks/bitnob", {
      method: "POST",
      body,
      headers: { "content-type": "application/json", ...(signature ? { "x-bitnob-signature": signature } : {}) },
    });
  return { store, dispatcher, seen, log, post };
}

describe("signature", () => {
  it("accepts a valid HMAC-SHA512, with or without sha512= prefix", () => {
    const sig = signBitnobPayload(SECRET, "{}");
    expect(sig).toMatch(/^[0-9a-f]{128}$/);
    expect(verifyBitnobSignature(SECRET, "{}", sig)).toBe(true);
    expect(verifyBitnobSignature(SECRET, "{}", `sha512=${sig}`)).toBe(true);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["wrong secret", signBitnobPayload("other", "{}")],
    ["sha256 length", "a".repeat(64)],
    ["not hex", "z".repeat(128)],
  ])("rejects %s", (_name, header) => {
    expect(verifyBitnobSignature(SECRET, "{}", header)).toBe(false);
  });

  it("rejects when the body was changed after signing", () => {
    const sig = signBitnobPayload(SECRET, '{"a":1}');
    expect(verifyBitnobSignature(SECRET, '{"a":2}', sig)).toBe(false);
  });

  it("refuses to start without a secret", () => {
    expect(() =>
      bitnobWebhookRoutes({ secret: "", store: new InMemoryEventStore(), dispatcher: new GithubDispatcher() }),
    ).toThrow("BITNOB_WEBHOOK_SECRET");
  });
});

describe("POST /webhooks/bitnob", () => {
  it("stores and dispatches a signed event", async () => {
    const { post, store, seen } = setup();
    const res = await post(JSON.stringify(success));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    const row = await store.get("bitnob", success.event_id);
    expect(row).toMatchObject({ source: "bitnob", type: "payouts.withdrawal.success", status: "processed" });
    expect(seen).toHaveLength(1);
  });

  it("dispatches on the Bitnob event name", async () => {
    const { post, dispatcher } = setup();
    const onSuccess = vi.fn();
    const onDeposit = vi.fn();
    dispatcher.on("payouts.withdrawal.success", onSuccess).on("virtual_account.deposit.success", onDeposit);
    await post(JSON.stringify(success));
    await post(JSON.stringify(deposit));
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onDeposit).toHaveBeenCalledTimes(1);
  });

  it("bad signature: 401, nothing stored, nothing dispatched", async () => {
    const { post, store, seen } = setup();
    const body = JSON.stringify(success);
    const res = await post(body, signBitnobPayload("wrong", body));
    expect(res.status).toBe(401);
    expect(store.all()).toHaveLength(0);
    expect(seen).toHaveLength(0);
  });

  it("missing signature: 401", async () => {
    const { post } = setup();
    expect((await post(JSON.stringify(success), "")).status).toBe(401);
  });

  it("replayed event: stored once, dispatched once", async () => {
    const { post, store, seen } = setup();
    const body = JSON.stringify(success);
    await post(body);
    const res = await post(body);
    expect(await res.json()).toMatchObject({ ok: true, duplicate: true });
    expect(store.all()).toHaveLength(1);
    expect(seen).toHaveLength(1);
  });

  it("out of order (processing after success): both stored and dispatched; the handler decides", async () => {
    const { post, seen } = setup();
    await post(JSON.stringify(success));
    await post(JSON.stringify(processing));
    expect(seen.map((e) => e.type)).toEqual(["payouts.withdrawal.success", "payouts.processing"]);
  });

  it("a handler error answers 500 and the redelivery is processed again", async () => {
    const { post, dispatcher, store } = setup();
    let fail = true;
    dispatcher.on("payouts.withdrawal.success", () => {
      if (fail) throw new Error("db down");
    });
    const body = JSON.stringify(success);
    expect((await post(body)).status).toBe(500);
    expect((await store.get("bitnob", success.event_id))?.status).toBe("failed");
    fail = false;
    expect((await post(body)).status).toBe(200);
    expect((await store.get("bitnob", success.event_id))?.status).toBe("processed");
  });

  it.each([
    ["invalid JSON", "{not json"],
    ["no event id", JSON.stringify({ event: "payouts.processing", data: {} })],
    ["no event name", JSON.stringify({ event_id: "x", data: {} })],
    ["an array", "[]"],
  ])("400 on %s", async (_name, body) => {
    const { post, store } = setup();
    expect((await post(body)).status).toBe(400);
    expect(store.all()).toHaveLength(0);
  });
});

describe("normalizers", () => {
  it("reads a payout success", () => {
    expect(toPayoutUpdate(parseEnvelope(success)!)).toEqual({
      bitnobPayoutId: success.data.id,
      quoteId: "QT2_21434859",
      reference: "pay-b1-1",
      outcome: "success",
      rawStatus: "success",
    });
  });

  it("an expired payout is a failure", () => {
    const env = parseEnvelope({ ...success, event: "payouts.withdrawal.expired", data: { ...success.data, status: "expired" } })!;
    expect(toPayoutUpdate(env)?.outcome).toBe("failed");
  });

  it("falls back on the event name when data.status is missing", () => {
    const env = parseEnvelope({ event: "payouts.withdrawal.success", event_id: "e", data: { id: "p" } })!;
    expect(toPayoutUpdate(env)?.outcome).toBe("success");
  });

  it.each([
    ["SUCCESS", "success"],
    ["completed", "success"],
    ["EXPIRED", "failed"],
    ["failed", "failed"],
    ["QUOTE", "quote"],
    ["INITIATED", "initiated"],
    ["processing", "processing"],
    ["something-new", "processing"],
  ] as const)("status %s → %s", (raw, outcome) => {
    expect(toPayoutOutcome(raw)).toBe(outcome);
  });

  it("reads a deposit with a camelCase envelope, amount in kobo", () => {
    expect(toDepositUpdate(parseEnvelope(deposit)!)).toEqual({
      virtualAccountId: "va1",
      reference: "sbx-dep-1",
      amountMinor: 100000,
      currency: "NGN",
    });
  });

  it("a non-integer deposit amount is null, not a float", () => {
    const env = parseEnvelope({ ...deposit, data: { ...deposit.data, amount: "1000.50" } })!;
    expect(toDepositUpdate(env)?.amountMinor).toBeNull();
  });

  it("returns null for the other family", () => {
    expect(toPayoutUpdate(parseEnvelope(deposit)!)).toBeNull();
    expect(toDepositUpdate(parseEnvelope(success)!)).toBeNull();
  });
});

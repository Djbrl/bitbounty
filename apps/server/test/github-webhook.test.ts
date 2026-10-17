import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GithubDispatcher,
  InMemoryEventStore,
  createGithubApp,
  githubWebhookRoutes,
  normalizePrivateKey,
  readGithubAppConfig,
  signPayload,
  verifySignature,
  type StoredEvent,
} from "../src/github/index.js";

const SECRET = "test-webhook-secret";
const fixture = readFileSync(
  new URL("../src/github/__fixtures__/issue_comment.created.json", import.meta.url),
  "utf8",
);

function post(
  app: ReturnType<typeof githubWebhookRoutes>,
  body: string,
  headers: Record<string, string | undefined>,
) {
  const h: Record<string, string> = { "content-type": "application/json" };
  for (const [k, v] of Object.entries(headers)) if (v !== undefined) h[k] = v;
  return app.request("/webhooks/github", { method: "POST", body, headers: h });
}

const deliveryHeaders = (delivery: string, event = "issue_comment", body = fixture) => ({
  "x-github-event": event,
  "x-github-delivery": delivery,
  "x-hub-signature-256": signPayload(SECRET, body),
});

describe("verifySignature", () => {
  it("accepts the right signature and rejects others", () => {
    const sig = signPayload(SECRET, "hello");
    expect(verifySignature(SECRET, "hello", sig)).toBe(true);
    expect(verifySignature(SECRET, "hello!", sig)).toBe(false);
    expect(verifySignature("other", "hello", sig)).toBe(false);
    expect(verifySignature(SECRET, "hello", sig.replace("sha256=", "sha1="))).toBe(false);
    expect(verifySignature(SECRET, "hello", "sha256=abc")).toBe(false);
    expect(verifySignature(SECRET, "hello", undefined)).toBe(false);
  });
});

describe("POST /webhooks/github", () => {
  let store: InMemoryEventStore;
  let dispatcher: GithubDispatcher;
  let received: StoredEvent[];
  let app: ReturnType<typeof githubWebhookRoutes>;
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  beforeEach(() => {
    store = new InMemoryEventStore();
    dispatcher = new GithubDispatcher();
    received = [];
    dispatcher.on("issue_comment.created", (e) => {
      received.push(e);
    });
    app = githubWebhookRoutes({ secret: SECRET, store, dispatcher, log });
  });

  it("accepts a valid signature, stores the event and dispatches it", async () => {
    const res = await post(app, fixture, deliveryHeaders("d-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });

    const rows = store.all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: "github",
      externalId: "d-1",
      type: "issue_comment",
      action: "created",
      repo: "bitbounty-demo/sandbox",
      installationId: 55500001,
      status: "processed",
    });
    expect((rows[0]!.payload as any).comment.body).toBe("/bounty 10000");
    expect(rows[0]!.receivedAt).toBeInstanceOf(Date);

    expect(received).toHaveLength(1);
    expect(received[0]!.externalId).toBe("d-1");
  });

  it("rejects a bad signature with 401 and stores nothing", async () => {
    const forged = fixture.replace("/bounty 10000", "/pay @attacker now");
    const res = await post(app, forged, deliveryHeaders("d-2")); // signature of the original body
    expect(res.status).toBe(401);
    expect(store.all()).toHaveLength(0);
    expect(received).toHaveLength(0);
  });

  it("rejects a signature made with another secret", async () => {
    const res = await post(app, fixture, {
      ...deliveryHeaders("d-3"),
      "x-hub-signature-256": signPayload("wrong-secret", fixture),
    });
    expect(res.status).toBe(401);
    expect(store.all()).toHaveLength(0);
  });

  it("rejects a missing signature with 401", async () => {
    const res = await post(app, fixture, { ...deliveryHeaders("d-4"), "x-hub-signature-256": undefined });
    expect(res.status).toBe(401);
    expect(store.all()).toHaveLength(0);
  });

  it("returns 400 when delivery or event headers are missing", async () => {
    const res = await post(app, fixture, { ...deliveryHeaders("d-5"), "x-github-delivery": undefined });
    expect(res.status).toBe(400);
    expect(store.all()).toHaveLength(0);
  });

  it("dedupes a redelivered event: 200, stored once, dispatched once", async () => {
    const first = await post(app, fixture, deliveryHeaders("d-6"));
    const second = await post(app, fixture, deliveryHeaders("d-6"));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ ok: true, duplicate: true });
    expect(store.all()).toHaveLength(1);
    expect(received).toHaveLength(1);
  });

  it("marks the event failed when a handler throws, and retries it on redelivery", async () => {
    let calls = 0;
    dispatcher.on("issue_comment", () => {
      calls++;
      if (calls === 1) throw new Error("db down");
    });
    const first = await post(app, fixture, deliveryHeaders("d-7"));
    expect(first.status).toBe(500);
    expect(store.all()[0]).toMatchObject({ status: "failed", error: "db down" });

    const retry = await post(app, fixture, deliveryHeaders("d-7"));
    expect(retry.status).toBe(200);
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0]).toMatchObject({ status: "processed", error: null });
    expect(calls).toBe(2);
  });

  it("routes pull_request events to pull_request handlers only", async () => {
    const prs: StoredEvent[] = [];
    dispatcher.on("pull_request.closed", (e) => {
      prs.push(e);
    });
    const body = JSON.stringify({
      action: "closed",
      pull_request: { number: 7, merged: true, body: "Fixes #42" },
      repository: { full_name: "bitbounty-demo/sandbox" },
      installation: { id: 55500001 },
    });
    const res = await post(app, body, deliveryHeaders("d-8", "pull_request", body));
    expect(res.status).toBe(200);
    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({ type: "pull_request", action: "closed" });
    expect(received).toHaveLength(0);
  });

  it("refuses to start without a secret", () => {
    expect(() => githubWebhookRoutes({ secret: "", store, dispatcher })).toThrow(/GITHUB_WEBHOOK_SECRET/);
  });
});

describe("GitHub App client factory", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

  it("reads env, normalizes a one-line or base64 private key, and builds an App", () => {
    expect(normalizePrivateKey(pem.replace(/\n/g, "\\n"))).toBe(pem.trim());
    expect(normalizePrivateKey(Buffer.from(pem).toString("base64"))).toBe(pem.trim());
    const config = readGithubAppConfig({
      GITHUB_APP_ID: "123",
      GITHUB_PRIVATE_KEY: pem.replace(/\n/g, "\\n"),
      GITHUB_WEBHOOK_SECRET: SECRET,
    });
    const app = createGithubApp(config);
    expect(typeof app.getInstallationOctokit).toBe("function");
  });

  it("names the missing env vars", () => {
    expect(() => readGithubAppConfig({ GITHUB_APP_ID: "1" })).toThrow(
      /GITHUB_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET/,
    );
  });
});

/**
 * B6 sandbox proof: a bounty payout over Lightning, through the real modules (Settlement →
 * PayoutService → LNURL-pay → Bitnob `POST /api/lightning/pay`). **Bitnob SANDBOX only**: refuses
 * to run unless `GET /api/whoami` says `environment=sandbox`.
 *
 *   pnpm --filter @bitbounty/server payout:smoke -- --dry-run        # resolve + check the invoice, pay nothing
 *   pnpm --filter @bitbounty/server payout:smoke                     # pays (sandbox sats), 200 FCFA by default
 *   options: --amount=200 (FCFA)  --wrong-amount (the receiver returns an invoice for 1 sat more)
 *            --address=user@domain (a real testnet Lightning Address instead of the local receiver)
 *
 * Without --address, the developer's Lightning Address is served by a tiny local LNURL-pay
 * server (`dev@127.0.0.1:<port>`) whose callback returns a **Bitnob sandbox invoice** for the exact
 * amount asked (created with `POST /api/lightning/invoices`): Bitnob pays its own invoice.
 * Prints a sanitized log: no keys, BOLT11s truncated, the address masked.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { BitnobClient, BitnobError, readBitnobConfig } from "@bitbounty/bitnob";
import { createBounty, maskLightningAddress, type InternalEvent } from "@bitbounty/core";
import { InMemoryBountyRepo } from "../src/bounties/repo.js";
import { BitnobRates } from "../src/funding/index.js";
import { InMemoryEventBus } from "../src/github/pr/index.js";
import { decodeBolt11, HttpLnurlResolver, InMemoryPayoutStore, PayoutService } from "../src/payouts/index.js";
import { Settlement } from "../src/settlement/index.js";

const args = new Map(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, ...v] = a.slice(2).split("=");
      return [k!, v.length ? v.join("=") : "true"] as const;
    }),
);
const dryRun = args.has("dry-run");
const wrongAmount = args.has("wrong-amount");
const amountXof = Number(args.get("amount") ?? 200);
const t0 = Date.now();
const log = (line: string) => console.log(`[+${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s] ${line}`);
const short = (bolt11: string) => `${bolt11.slice(0, 20)}…(${bolt11.length} chars)`;

const client = new BitnobClient(readBitnobConfig());
const who = await client.whoami();
log(`whoami: environment=${who.environment} client_name=${JSON.stringify(who.client_name)}`);
if (String(who.environment).toLowerCase() !== "sandbox") {
  console.error(`Refusing: Bitnob environment is "${who.environment}", not sandbox.`);
  process.exit(2);
}
const btcBalance = async () => {
  const data = await client.request<{ accounts?: { currency: string; available_balance: string }[] }>("GET", "/api/balances");
  return Number(data.accounts?.find((a) => a.currency === "BTC")?.available_balance ?? NaN);
};
const before = await btcBalance();
log(`BTC balance before: ${before} sats`);

// ---- the developer's Lightning Address: a local LNURL-pay server backed by Bitnob sandbox invoices ----
const invoices: { id: string; sats: number; reference: string }[] = [];
let customerId: string | undefined;
let address = args.get("address");
let server: ReturnType<typeof createServer> | undefined;
if (!address) {
  const metadata = JSON.stringify([["text/plain", "BitBounty B6 sandbox proof"]]);
  server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const port = (server!.address() as AddressInfo).port;
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
      };
      if (url.pathname === "/.well-known/lnurlp/dev") {
        log(`lnurl: GET ${url.pathname} → payRequest (min 1 000 msat, max 10 000 000 msat)`);
        return json(200, { tag: "payRequest", callback: `http://127.0.0.1:${port}/lnurl/callback`, minSendable: 1_000, maxSendable: 10_000_000, metadata });
      }
      if (url.pathname === "/lnurl/callback") {
        const msat = Number(url.searchParams.get("amount"));
        const sats = Math.floor(msat / 1000) + (wrongAmount ? 1 : 0);
        customerId ??= (
          await client.createCustomer({ email: `b6-smoke-${Date.now()}@bitbounty.invalid`, customer_type: "individual", reference: `b6-smoke-${Date.now()}` })
        ).id;
        const reference = `b6-smoke-recv-${Date.now()}`;
        const inv = await client.createLightningInvoice({ customer_id: customerId, amount: sats, description: "BitBounty B6 sandbox proof", expiry: 900, reference });
        invoices.push({ id: inv.id, sats, reference });
        log(`lnurl: callback amount=${msat} msat → Bitnob sandbox invoice ${inv.id} for ${sats} sats${wrongAmount ? " (deliberately 1 sat too many)" : ""}: ${short(String(inv.request))}`);
        return json(200, { pr: inv.request, routes: [] });
      }
      json(404, { status: "ERROR", reason: "not found" });
    })().catch((err: unknown) => {
      log(`lnurl: error ${err instanceof Error ? err.message : String(err)}`);
      res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ status: "ERROR", reason: "receiver failed" }));
    });
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  address = `dev@127.0.0.1:${(server.address() as AddressInfo).port}`;
  log(`local LNURL receiver up: ${address}`);
}

const rates = new BitnobRates(client);
const resolver = new HttpLnurlResolver({ network: "testnet", allowLocal: true });

if (dryRun) {
  const [xofUsdt, usdtBtc] = await Promise.all([rates.xofPerUsdt(), rates.usdtPerBtc()]);
  const sats = Math.floor((amountXof * 1e8) / (xofUsdt * usdtBtc));
  log(`rate: ${xofUsdt} FCFA/USDT × ${usdtBtc} USDT/BTC → ${amountXof} FCFA = ${sats} sats (rounded down)`);
  try {
    const inv = await resolver.invoiceFor(address, sats * 1000);
    const local = decodeBolt11(inv.bolt11);
    const remote = await client.decodeLightningInvoice(inv.bolt11);
    log(`invoice accepted: ${short(inv.bolt11)} hash=${inv.paymentHash} expires=${inv.expiresAt}`);
    log(`cross-check with Bitnob /lightning/decode: amount_msat ${remote.amount_msat} (ours ${local.amountMsat}), hash ${remote.payment_hash === local.paymentHash ? "same" : "DIFFERENT"}, expires_at ${remote.expires_at} (ours ${local.expiresAt})`);
  } catch (err) {
    log(`invoice refused, nothing paid: ${err instanceof Error ? err.message : String(err)}`);
  }
  server?.close();
  process.exit(0);
}

// ---- a verified bounty, settlement and the payout service, wired like app.ts ----
const repo = new InMemoryBountyRepo();
const bountyId = `b6-smoke-${Date.now()}`;
const { bounty } = createBounty({
  id: bountyId,
  repoFullName: "bitbounty-smoke/b6",
  issueNumber: 1,
  issueTitle: "B6 sandbox proof",
  amountXof,
  criteria: [],
  funderKind: "human",
  funderId: "github:smoke-funder",
  createdAt: new Date().toISOString(),
});
repo.add({ ...bounty, status: "verified", verdict: "pass" }, { claimId: "c1", userId: "github:smoke-dev", login: "smoke-dev" });
const bus = new InMemoryEventBus();
const events: InternalEvent[] = [];
const quietLog = { info: (m: string) => log(m), warn: (m: string) => log(m), error: (m: string) => log(m) };
const store = new InMemoryPayoutStore();
const holder: { payouts?: PayoutService } = {};
const settlement = new Settlement({
  repo,
  bus,
  startPayout: (req) => holder.payouts!.start(req),
  objectionMs: 0,
  log: quietLog,
}).register();
for (const type of ["payout.started", "payout.succeeded", "payout.failed"] as const) {
  bus.subscribe(type, (e) => {
    events.push(e);
    log(`EVENT ${JSON.stringify(e)}`);
  });
}
const payouts = new PayoutService({
  rails: client,
  resolver,
  rates,
  store,
  emit: settlement.applyPayoutEvent,
  getPayee: async () => ({ lightningAddress: address! }),
  customerId: process.env.BITNOB_PAYOUT_CUSTOMER_ID?.trim() || undefined,
  retryDelaysMs: [3_000, 6_000],
  log: quietLog,
});
holder.payouts = payouts;

log(`bounty ${bountyId}: verified, ${amountXof} FCFA, claimant @smoke-dev → ${maskLightningAddress(address)}`);
// Duplicate triggers on purpose: a merge redelivered twice and a direct start, at the same time.
await Promise.all([
  bus.publish({ type: "pr.merged", bountyId, occurredAt: new Date().toISOString(), prNumber: 2, ciGreen: true }),
  bus.publish({ type: "pr.merged", bountyId, occurredAt: new Date().toISOString(), prNumber: 2, ciGreen: true }),
  payouts.start({ bountyId, userId: "github:smoke-dev", amountXof }),
]);

const deadline = Date.now() + 180_000;
for (;;) {
  const row = await store.getByBounty(bountyId);
  const b = await repo.findById(bountyId);
  if (row && (row.status === "succeeded" || row.status === "failed")) break;
  if (Date.now() > deadline) {
    log("timed out waiting for Bitnob");
    break;
  }
  await new Promise((r) => setTimeout(r, 3_000));
  log(`poll: payout ${row?.status ?? "none"} (attempt ${row?.attempts ?? 0}), bounty ${b?.status}`);
  await payouts.poll();
}

const row = await store.getByBounty(bountyId);
const after = await btcBalance();
log(
  `payout row: status=${row?.status} attempts=${row?.attempts} reference=${row?.reference}-${row?.attempts} sats=${row?.amountSats} ` +
    `rate=${row?.xofPerBtc ? Math.round(row.xofPerBtc) : "?"} FCFA/BTC bitnobPaymentId=${row?.bitnobPayoutId ?? "none"} hash=${row?.paymentHash ?? "none"} ` +
    `sentAt=${row?.sentAt ?? "never"} lastError=${row?.lastError ?? "none"}`,
);
log(`bounty status: ${(await repo.findById(bountyId))?.status}`);
for (const inv of invoices) {
  const now = await client.getLightningInvoice(inv.id).catch((err: unknown) => ({ status: `unreadable (${err instanceof BitnobError ? err.status : "?"})` }));
  log(`receiver invoice ${inv.id} (${inv.sats} sats): Bitnob status=${String(now.status)}`);
}
log(`BTC balance after: ${after} sats (Δ ${after - before})`);
const counts = events.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.type]: (acc[e.type] ?? 0) + 1 }), {});
log(`events: ${JSON.stringify(counts)}`);
server?.close();
process.exit(row?.status === "succeeded" ? 0 : 1);

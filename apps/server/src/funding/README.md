# Funding (B1 Lightning, B4 naira)

Turns a bounty from `unfunded` to `funded`: collect the money on Bitnob, then emit `funding.paid` **once per bounty**.

## Price
`priceBounty(amountXof)`: bounty + **5% fee** + **3% exchange-rate buffer**, each rounded up, whole FCFA. Converted with `BitnobRates` (USDT→XOF and USDT→NGN from `GET /api/exchange-rates`, BTC→USDT from `GET /api/trading/prices`, cached 60 s), rounded up to whole sats / naira.

## Lightning (B1)
```ts
const lightning = new LightningFunding({ client, store, rates, customers, bounties: bountyRepo, emit, credit });
const f = await lightning.invoice({ bountyId, funderId }); // W3 shows f.paymentRequest (BOLT11)
lightning.watch(f.id);          // fund page open → checked every 3 s
lightning.startPolling();       // watched every 3 s, all pending every 30 s (Bitnob has no Lightning webhook)
```
- Bitnob needs a customer per invoice: `BitnobFunderCustomers` creates one per funder and remembers it.
- With `bounties` set (app.ts passes the shared `bountyRepo`), `invoice()` reads the bounty: the amount comes from it, never from the caller, and only an `unfunded` bounty gets an invoice (`BOUNTY_NOT_FOUND`, `NOT_FUNDABLE` for cancelled/refunded, `ALREADY_FUNDED` otherwise).
- `invoice()` returns the open invoice while it has more than 1 min left, otherwise creates a new one (`fund-<bountyId>-<n>`). A funded bounty refuses new invoices (`ALREADY_FUNDED`). Concurrent calls for one bounty share one Bitnob call; a Bitnob `409 DUPLICATE_KEY_ERROR` (another process created that reference) returns the open invoice from the store, or retries once with a suffixed reference if none is stored.
- An invoice Bitnob still calls pending 10 min (`expiryGraceMs`) after `expiresAt` gets one last check, then is marked expired locally so it isn't polled forever.
- A replaced invoice is no longer shown but **still watched**: money that arrives is never ignored.
- `store.markPaid()` is atomic and tells whether this is the bounty's first paid funding. First → `funding.paid`. Any later one (old invoice paid too, same invoice reported twice) → no event; the extra goes to `credit(funding, reason)` for the funder's balance.
- **Delivery is at least once (outbox).** `markPaid()` records `fundsBounty` and `notifiedAt: null`; the event (or credit) is sent, then `markNotified()`. If `emit` throws (queue or DB down, crash), the row stays un-notified and every `poll()` first re-delivers such rows. Consumers must be idempotent: `applyFundingPaid(bountyRepo, eventBus)` (the production `emit`) treats a bounty that already left `unfunded` as applied, and `transition()` rejects a second `funding.paid` anyway.
- `startPolling()` never overlaps passes (a slow Bitnob skips ticks instead of piling them up).

## Sandbox check (done-when: "invoice paid → event emitted"), run by a human
Paying is a funds transfer, so no agent or CI does it.
1. `pnpm --filter @bitbounty/server lightning:smoke -- 1000` (keys from the repo-root `.env`; refuses unless `whoami` says `sandbox`). It prints an `lntb…` BOLT11 for 2218-ish sats (1000 FCFA + 5% + 3%).
2. Pay it from a **testnet** Lightning wallet (a testnet faucet wallet such as htlc.me, or `lncli --network=testnet payinvoice <bolt11>`). Mainnet wallets can't pay it.
3. Within ~3 s of Bitnob reporting it paid, the script prints `EVENT {"type":"funding.paid",…}` and exits 0 (exits 1 if the invoice expires first, after 15 min).
Agent run, 2026-10-17: invoice created (1000 FCFA → 2218 sats, `lntb22180n1…`, 15 min expiry), polled `pending`; not paid.

## Wiring and follow-ups
- `app.ts` builds `lightningFunding` when `BITNOB_CLIENT_ID`/`SECRET` are set: shared `bountyRepo`, `emit = applyFundingPaid(bountyRepo, eventBus)`, polling started.
- Still missing: the HTTP route `POST /api/bounties/:id/funding {rail}` for the fund page (W3), and the status-comment sync after funding (dev-fund.ts does it with `syncIssue`).
- **Durable store (follow-up).** The store is in memory, so a restart forgets pending invoices and the outbox. `@bitbounty/db`'s `fundings` table lacks columns this needs (`funder_id`, `amount_xof`, `fee_xof`, `buffer_xof`, `payment_request`, `expires_at`, `funds_bounty`, `notified_at`), so a `DrizzleFundingStore` needs a migration first. Its `markPaid` must stay atomic (`UPDATE … WHERE status <> 'paid' RETURNING`, then check for another paid row of the bounty in the same transaction), and `listUnnotified` is `WHERE status = 'paid' AND notified_at IS NULL`.

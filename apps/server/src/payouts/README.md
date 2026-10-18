# Payouts (B6: Lightning)

`PayoutService` pays a bounty **in sats over Lightning** to the developer's Lightning Address
(e.g. `awa@blink.sv`). It replaced B2's Wave / Orange Money rail: the mentor confirmed mobile money
payouts won't work. Amounts stay shown in FCFA, paid in sats at the rate we already fetch (B1).

```
bounty verified ─(objection window)→ start()
  1. claim the row               pending → processing, attempt n           (compare-and-set)
  2. payout.started              Settlement moves the bounty to `paying`; if that fails → stop, nothing sent
  3. FCFA → sats                 floor(amountXof × 1e8 / (FCFA/USDT × USDT/BTC)), rate saved on the row
  4. LNURL-pay                   user@domain → /.well-known/lnurlp/user → callback?amount=<msat> → BOLT11
                                 checked: exact amount, network, ≥ 120 s before expiry, description hash
  5. sentAt saved, then ONE      POST /api/lightning/pay {request, reference: pay-<bountyId>-<n>, max_fee}
  6. paid / failed / pending     poll every 15 s (Lightning has no documented webhook; one is handled if it comes)
```

```ts
const payouts = new PayoutService({
  rails: bitnobClient,                                  // payLightningInvoice + getLightningPayment
  resolver: new HttpLnurlResolver({ network: readLightningNetwork() }),
  rates: new BitnobRates(bitnobClient),
  store,                                                // DrizzlePayoutStore when DATABASE_URL is set
  emit: settlement.applyPayoutEvent,                    // the paying-first gate, then the bus
  getPayee: payeeFromAccounts(readPayoutAccounts()),    // PAYOUT_ACCOUNTS until W4/B7
});
payouts.register(bitnobDispatcher);   // a Bitnob webhook whose data.reference is pay-<bountyId>-<n>
await payouts.resume();               // on boot: finish what a crash interrupted
payouts.startPolling();               // every 15 s, for payouts still processing
```

Emits `payout.started` (each attempt), `payout.succeeded`, `payout.failed` (each failed attempt).

## Never twice
| Situation | What happens |
| --- | --- |
| `start()` twice, or concurrently | one row per bounty, compare-and-set on (status, attempts): one invoice, one pay call |
| the bounty can't be saved as `paying` (on hold, DB down, CAS lost) | `applyPayoutEvent` throws `PayoutNotAllowedError`: the claim is undone (row back to `pending`, attempt not counted), **no LNURL call, no Bitnob call**. The next `/pay` or a restart tries again |
| LNURL server down, slow (10 s), HTML, 5xx, `{"status":"ERROR"}`, no invoice | nothing was sent: attempt failed, **retried** after 5 s then 30 s with a fresh invoice |
| invoice for another amount, any-amount invoice, wrong network, bad description hash, amount outside `minSendable`/`maxSendable`, invalid address | nothing was sent: **not retryable** (only the developer can fix their address) |
| `/lightning/pay` answers 400 / 422 / 429 | Bitnob refused it, nothing paid: retried with a new invoice |
| `/lightning/pay` answers 401 / 403 (e.g. `FEATURE_NOT_ENABLED`) | not retryable: setup problem |
| `/lightning/pay` times out, 5xx, 409 | **maybe paid**: stays `processing`, never a new attempt until Bitnob says failed |
| finding out after an unclear answer | `GET /api/lightning/invoices/:id` when Bitnob gave us an id; otherwise replay **the same reference with the same invoice**. Not a second payment: Bitnob documents pay as idempotent on `reference`, and one BOLT11 (one payment hash) settles at most once on Lightning |
| replay answers 400/422 after the invoice expired | the payment never existed and can't happen any more: attempt failed, new invoice |
| invoice expired before it was sent (crash in between) | attempt failed (nothing sent), new invoice |
| server killed after the claim / after the invoice / mid pay call | `resume()` re-runs the gate if no invoice was saved, sends a saved-but-unsent invoice, or asks Bitnob about a sent one (above) |
| 3 attempts failed | row `failed`, bounty `payout_failed`, money stays reserved for the developer |
| success seen twice (poll + webhook), `pending` after `paid`, event about an earlier attempt | ignored, `payout.succeeded` emitted once |
| mobile money rows (seed, pre-B6) | never driven over Lightning (`rail` must be `lightning`) |

Invariants fuzzed over 200 seeds in `test/payouts.test.ts`: at most one payment settles per bounty, and
attempt n+1's reference is only sent after attempt n failed at Bitnob (or never reached it).

Lightning Addresses are masked in logs, errors and the public API (`aw***@blink.sv`); the BOLT11 and
preimage never leave the server. `lastError` prefixes (`lnurl unreachable:`, `lnurl refused:`,
`payout account:`, `pay:`) drive the short public reason in the status comment (`settlement/status-extras.ts`).

## Where to pay
`PAYOUT_ACCOUNTS='{"awa-dev":"awa@blink.sv"}'` (or `{"awa-dev":{"lightningAddress":"awa@blink.sv"}}`) until
W4/B7 store accounts. `PayoutAccount.lightningAddress` exists in `@bitbounty/core` and `payout_accounts.lightning_address`
in the database (migration `0002_b6_lightning_payouts`), with the mobile money columns now optional.

## Persistence
`DrizzlePayoutStore` (Postgres, `payouts` table) when `DATABASE_URL` is set: `create` is
`insert … on conflict (bounty_id) do nothing`, `update` is `UPDATE … WHERE id AND status [AND attempts] RETURNING`.
`InMemoryPayoutStore` otherwise (tests, offline demo). Both run `test/payout-store.contract.test.ts`
(the Postgres half with `DATABASE_URL`), including a kill-and-restart that pays once.

## Config
| Env | |
| --- | --- |
| `LIGHTNING_NETWORK` | `testnet` (default, sandbox `lntb…`), `bitcoin`/`mainnet` with production keys. A typo refuses to start |
| `BITNOB_PAYOUT_CUSTOMER_ID` | optional `customer_id` sent on every pay (the v2 spec lists it as required; unverified) |
| `PAYOUT_ACCOUNTS` | Lightning Address per GitHub login |

Fee cap: `max_fee = max(10, 1 % of the sats)`.

## Sandbox check
Refuses to run unless `whoami` says `environment=sandbox`. Without `--address`, the developer's Lightning
Address is a tiny local LNURL-pay server whose callback returns a **Bitnob sandbox invoice** for the exact amount:
```bash
pnpm --filter @bitbounty/server payout:smoke -- --dry-run                 # resolve + check the invoice, cross-check with /lightning/decode
pnpm --filter @bitbounty/server payout:smoke -- --dry-run --wrong-amount  # the receiver answers 1 sat more → refused
pnpm --filter @bitbounty/server payout:smoke                              # pays (sandbox sats), duplicate triggers on purpose
```
**Status (2026-10-18): our sandbox account answers `403 FEATURE_NOT_ENABLED` ("The Lightning withdrawals
feature is currently not available", `feature_key: send_lightning`) to `/lightning/pay` and `/lightning/preview`.**
Everything up to the pay call is proven live; the payment itself needs Bitnob to enable `send_lightning`.

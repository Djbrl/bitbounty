# Payouts: Lightning

`PayoutService` pays a bounty **in sats over Lightning** to the developer's Lightning Address
(e.g. `awa@blink.sv`). Amounts are shown in FCFA and paid in sats at Bitnob's rate.

**Status:** implemented and tested against fakes; testnet by default. No payout has completed end to end:
the Bitnob sandbox refuses `/lightning/pay` (`403 FEATURE_NOT_ENABLED`, `send_lightning`) and our
production key is rejected with `401 Invalid HMAC` ([#86](https://github.com/Djbrl/bitbounty/issues/86)).

```
bounty verified ─(objection window)→ start()
  1. claim the row               pending → processing, attempt n           (compare-and-set, in flight from here)
  2. payout.started              Settlement moves the bounty to `paying`; if that fails → stop, nothing sent
  3. FCFA → sats                 floor(amountXof × 1e8 / (FCFA/USDT × USDT/BTC)), rate saved on the row;
                                 refused (not retried) above MAX_PAYOUT_SATS or outside 10 M–1 000 M FCFA/BTC
  4. LNURL-pay                   user@domain → /.well-known/lnurlp/user → callback?amount=<msat> → BOLT11
                                 checked: exact amount, network, ≥ 120 s before expiry, description hash;
                                 saved only if the attempt has no invoice yet (payment_request IS NULL)
  5. sentAt saved (only if unset), then ONE   POST /api/lightning/pay {request, reference: pay-<bountyId>-<n>, max_fee}
  6. paid / failed / pending     status reads with backoff 15 s → 1 h (no documented webhook; one is handled if it comes)
```

```ts
const payouts = new PayoutService({
  rails: bitnobClient,                                  // payLightningInvoice + getLightningPayment
  resolver: new HttpLnurlResolver({ network: readLightningNetwork() }),
  rates: new BitnobRates(bitnobClient),
  store,                                                // DrizzlePayoutStore when DATABASE_URL is set
  emit: settlement.applyPayoutEvent,                    // the paying-first gate, then the bus
  getPayee,                                             // PAYOUT_ACCOUNTS, then the address saved at /welcome or /me
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
| a poll tick (or a second server) reaches an attempt that is still being gated or resolving LNURL | the row is in flight in its process from before the claim; across processes the invoice is saved only if `payment_request IS NULL` and the send marked only if `sent_at IS NULL`, so exactly one worker sends |
| the bounty can't be saved as `paying` (on hold, DB down, CAS lost) | `applyPayoutEvent` throws `PayoutNotAllowedError`: the claim is undone (row back to `pending`, attempt not counted), **no LNURL call, no Bitnob call**. The next `/pay` or a restart tries again |
| LNURL server down, slow (10 s), HTML, 5xx, `{"status":"ERROR"}`, no invoice | nothing was sent: attempt failed, **retried** after 5 s then 30 s with a fresh invoice |
| invoice for another amount, any-amount invoice, wrong network, bad description hash, amount outside `minSendable`/`maxSendable`, invalid address | nothing was sent: **not retryable** (only the developer can fix their address) |
| first `/lightning/pay` of an attempt answers 400 / 422 / 429 | Bitnob refused the only request carrying that reference, nothing paid: the next attempt pays **the same invoice** while it has ≥ 5 min left (so even a misread refusal can't settle twice), else a new one |
| `/lightning/pay` answers 401 / 403 (e.g. `FEATURE_NOT_ENABLED`) | not retryable: setup problem |
| `/lightning/pay` times out, 5xx, 409 | **maybe paid**: stays `processing`, never a new attempt until Bitnob says failed |
| finding out after an unclear answer | **reads first**: `GET /api/lightning/invoices/:id` when Bitnob gave us an id, then `GET /api/lightning/invoices?reference=…` filtered by reference / payment hash (`findLightningPayment`; both **unverified for outgoing payments**, the sandbox refuses `send_lightning`). Only if nothing is found, **one** re-send of the same reference with the same invoice while it can still be paid (Bitnob documents pay as idempotent on `reference`; one payment hash settles at most once). Checks back off 15 s, 30 s, 1, 2, 5, 15, 30 min, then hourly |
| a re-send is refused (400/422, e.g. "reference already used") | **not** read as unpaid (the first send may be in flight): the attempt stays `processing` |
| sent, no status readable and the invoice expired | `lastError` = `stuck: …`, logged as an error, **nothing retried automatically**: check the payment in the Bitnob dashboard. A later webhook or readable status still settles it |
| invoice expired before it was sent (crash in between) | attempt failed (nothing sent), new invoice |
| server killed after the claim / after the invoice / mid pay call | an unsent attempt is re-checked (`isPayable`: bounty `paying`/`payout_failed`, same claimant and amount; else back to `pending`), re-gated, then sent once; a sent one is asked about (above) |
| `pending` row at boot (lost retry timer, or a start the gate refused) | retried only if `isPayable`; a bounty still `verified` waits for settlement (objection window) |
| the gate refused a start, then the bounty changed claimant or amount | the untouched row (nothing ever sent) follows the new claimant and amount on the next `start()`; a row that was sent never changes recipient |
| 3 attempts failed | row `failed`, bounty `payout_failed`, money stays reserved for the developer |
| success seen twice (poll + webhook), `pending` after `paid`, event about an earlier attempt | ignored, `payout.succeeded` emitted once |
| legacy rows with `rail = mobile_money` | never driven over Lightning; `start()` logs a warning |

Invariants fuzzed over 200 seeds in `test/payouts.test.ts`, with Bitnob idempotent on `reference` and again
with a Bitnob that refuses a known reference: at most one payment settles per bounty, and attempt n+1's
reference is only sent after attempt n failed at Bitnob (or never reached it). The review fixes (races, refusals,
backoff, cap, resume) each have a test in `test/payouts-review.test.ts`.

Lightning Addresses are masked in logs, errors and the public API (`aw***@blink.sv`); the BOLT11 and
preimage never leave the server. `lastError` prefixes (`lnurl unreachable:`, `lnurl refused:`,
`payout account:`, `pay refused:`, `setup:`) drive the short public reason in the status comment and the public
payout view (`settlement/status-extras.ts`); the raw error stays in the logs and the payout row.

## Where to pay
`PAYOUT_ACCOUNTS='{"awa-dev":"awa@blink.sv"}'` (or `{"awa-dev":{"lightningAddress":"awa@blink.sv"}}`) first,
then the Lightning Address the developer saved on the web (`payout_accounts.lightning_address`). With neither,
the payout fails on its first attempt with a `payout account:` reason.

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
| `MAX_PAYOUT_SATS` | hard cap on one payout (default `100000`); above it the payout fails, not retried, public reason `setup` |

Fee cap: `max_fee = max(10, 1 % of the sats)`.

## Sandbox check
Refuses to run unless `whoami` says `environment=sandbox`. Without `--address`, the developer's Lightning
Address is a tiny local LNURL-pay server whose callback returns a **Bitnob sandbox invoice** for the exact amount:
```bash
pnpm --filter @bitbounty/server payout:smoke -- --dry-run                 # resolve + check the invoice, cross-check with /lightning/decode
pnpm --filter @bitbounty/server payout:smoke -- --dry-run --wrong-amount  # the receiver answers 1 sat more → refused
pnpm --filter @bitbounty/server payout:smoke                              # pays (sandbox sats), duplicate triggers on purpose
```
Result: everything up to the pay call works against the sandbox. The pay call itself (and `/lightning/preview`)
answers `403 FEATURE_NOT_ENABLED` ("The Lightning withdrawals feature is currently not available").


## Live test on production
`scripts/live-pay.ts` makes one tiny real payout on Bitnob **production**, run by a human. Not completed yet:
our production key gets `401 Invalid HMAC` (#86).
It reads `--env-file` (default: repo-root `.env.prod`, never the dev `.env`):

| Env | |
| --- | --- |
| `BITNOB_PROD_CLIENT_ID`, `BITNOB_PROD_CLIENT_SECRET` | production creds (never printed) |
| `LIVE_TEST_LIGHTNING_ADDRESS` | where the test sats go (dry run falls back to `bitbounty@blink.sv`; `--pay` requires it) |
| `BITNOB_PROD_PAYOUT_CUSTOMER_ID` | optional `customer_id` for the pay call |

```bash
pnpm --filter @bitbounty/server live-pay -- --sats 100            # dry run: nothing is sent
pnpm --filter @bitbounty/server live-pay -- --xof 50              # FCFA → sats at Bitnob's rate (needs the creds)
pnpm --filter @bitbounty/server live-pay -- --sats 100 --pay      # the real payment
```
- **Dry run (default)**: resolves the Lightning Address with `HttpLnurlResolver` (network `bitcoin`),
  requests the real invoice for the exact amount (costs nothing), decodes it with our BOLT11 decoder and checks
  amount, network = `bitcoin`, ≥ 120 s before expiry and description hash = sha256(LNURL metadata), then prints the
  summary. With creds it runs `whoami` and prints the environment. A `401` prints why: the client ID and secret
  don't belong together (Bitnob uses the same client ID across environments, only the secret changes; a secret
  issued for another company won't work with ours).
- `--max-sats` is a hard cap (default `1000`): above it the script refuses before any call.
- **`--pay`**: the same checks, refused unless `whoami` says `production`, then you must type the exact sats
  amount. It pays that one invoice through `PayoutService` itself (the bounty payout code path: one
  `POST /api/lightning/pay` with reference `pay-live-test-<timestamp>-1`, the bounty payout format; status
  reads, at most one idempotent re-send, `maxAttempts: 1` so a confirmed failure is never retried with a new
  invoice), polls for 3 minutes and prints the result. If the outcome is still unknown, check the Bitnob
  dashboard before running `--pay` again.
- Exit codes: 0 ok, 1 payment failed or unknown, 2 refused by a check, 3 aborted at the prompt.


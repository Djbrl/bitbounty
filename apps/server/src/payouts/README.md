# Payouts (B2)

`PayoutService` pays a bounty to the developer's Wave / Orange Money / Free Money through Bitnob:
**quote → initialize → finalize**, up to 3 attempts, and never twice.

```ts
const payouts = new PayoutService({ rails: bitnobClient, store, emit, getBeneficiary, callbackUrl });
payouts.register(bitnobDispatcher);   // B5 webhooks → handleUpdate()
await payouts.resume();               // on boot: finish what a crash interrupted
payouts.startPolling();               // every 15 s, for payouts still processing
await payouts.start({ bountyId, userId, amountXof }); // when the bounty becomes `verified`
```

Emits `payout.started` (each attempt), `payout.succeeded`, `payout.failed` (each failed attempt) from `@bitbounty/core`.

## Rules
| Situation | What happens |
| --- | --- |
| `start()` called twice, or concurrently | one row per bounty (`pay-<bountyId>`), compare-and-set on status: only one attempt runs |
| quote / initialize fails (400, 5xx, network) | nothing was debited: attempt failed, retry after 5 s then 30 s with a **new quote** |
| quote / initialize answers 401 / 403 / 422, or a config error (missing bank code) | **not retryable**: row `failed` after that one attempt |
| quote's `settlement_amount` ≠ the bounty amount | not retryable, nothing initialized |
| finalize | sent **once** (`{ retries: 0 }`): no client-level replay |
| finalize errors in any way (timeout, 5xx, 409, 422…) | we ask Bitnob (`GET /api/payouts/:id`). Attempt fails **only** if Bitnob says expired/failed, or has no such payout (404). Otherwise **maybe paid**: stays `processing`, poll/webhooks settle it |
| poll / resume finds the payout `INITIATED` | **waits**. A finalize may already have been sent, so it is never re-sent; Bitnob must move it to success or expired |
| poll / resume finds a bare `QUOTE` | Bitnob confirms nothing was initialized (so nothing finalized): initialize + finalize |
| Bitnob says `expired` / failed (webhook or poll) | attempt failed, retry with a new quote |
| 3 attempts failed | row `failed`, money stays reserved for the developer (bounty `payout_failed`) |
| success webhook twice, or `processing` after `success` | ignored, `payout.succeeded` emitted once |
| server killed between create and first attempt | `resume()` runs every `pending` row, including `attempts = 0` |
| server killed mid-payout | `resume()`: redoing the quote with the same per-attempt reference `pay-<bountyId>-<n>` returns the same Bitnob payout; then it acts on Bitnob's real status as above |
| quote expired before initialize | attempt failed, new quote |

Invariant (fuzzed over 200 seeds in `test/payouts.test.ts`): at most one Bitnob payout per bounty ever reaches `processing`/`success`.

Errors in `lastError`, `payout.failed` and the logs mask phone numbers (`+2217******67`).

The beneficiary (`provider`, `phoneE164`, `accountName`, `country`) is read at each attempt. The Bitnob `bank_code` comes from `GET /api/payouts/banks/:country` (cached only when non-empty), else from `BITNOB_<CC>_BANK_CODES`, e.g. `BITNOB_SN_BANK_CODES='{"wave":"…","orange":"…"}'`. **The sandbox answers `{"banks":null}` for SN**, and there are no default codes: confirm them with Bitnob at the workshop. Without them a payout fails with `no Bitnob bank_code for wave in SN …`.

## Not wired yet
`app.ts` doesn't instantiate the service: it needs the Postgres store (F3) and the payout accounts (B3/W4). `InMemoryPayoutStore` is the reference implementation of `PayoutStore` (the Drizzle one must keep `update()` a compare-and-set: `UPDATE … WHERE id = $1 AND status = $2 AND attempts = $3`).

## Sandbox check
Aborts unless `whoami` says `environment=sandbox`. `--dry-run` is read-only (whoami, banks, bank code, one quote):
```bash
pnpm --filter @bitbounty/server payout:smoke -- --dry-run +221XXXXXXXXX wave "Awa Diop" 137
pnpm --filter @bitbounty/server payout:smoke -- +221XXXXXXXXX wave "Awa Diop" 137   # finalizes: humans only
```

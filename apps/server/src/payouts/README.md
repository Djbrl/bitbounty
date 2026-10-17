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
| quote / initialize fails | nothing was debited: attempt failed, retry after 5 s then 30 s with a **new quote** |
| finalize answers 4xx | definite failure: same as above |
| finalize times out / network / 5xx | **maybe paid**: stays `processing`, no retry; polling asks Bitnob (`GET /api/payouts/:id`) |
| Bitnob says `expired` / failed (webhook or poll) | attempt failed, retry with a new quote |
| 3 attempts failed | row `failed`, money stays reserved for the developer (bounty `payout_failed`) |
| success webhook twice, or `processing` after `success` | ignored, `payout.succeeded` emitted once |
| server killed mid-payout | `resume()`: redoing the quote with the same per-attempt reference `pay-<bountyId>-<n>` returns the same Bitnob payout; then it acts on Bitnob's real status (initialize / finalize / wait / done) |
| quote expired before initialize | attempt failed, new quote |

The beneficiary (`provider`, `phoneE164`, `accountName`, `country`) is read at each attempt; the Bitnob `bank_code` comes from `GET /api/payouts/banks/:country` (cached).

## Not wired yet
`app.ts` doesn't instantiate the service: it needs the Postgres store (F3) and the payout accounts (B3/W4). `InMemoryPayoutStore` is the reference implementation of `PayoutStore` (the Drizzle one must keep `update()` a compare-and-set: `UPDATE … WHERE id = $1 AND status = $2 AND attempts = $3`).

## Sandbox check
```bash
pnpm --filter @bitbounty/server payout:smoke -- +221771234567 wave "Awa Diop" 137
```

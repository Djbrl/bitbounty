# Funding

Moves a bounty from `unfunded` to `funded`: collect the money on Bitnob, then emit `funding.paid` once per bounty.

| Rail | File | Status |
| --- | --- | --- |
| Lightning (sats) | `lightning.ts` | wired in `app.ts` when Bitnob keys are set; `POST /api/bounties/:id/funding {rail: "lightning"}` serves the payment page |
| Naira (NGN virtual account → BTC) | `ngn.ts` | proven in the Bitnob sandbox (`ngn:smoke`), **not wired on the server** ([#168](https://github.com/Djbrl/bitbounty/issues/168)): the route answers `501` for `ngn` and `usdt` |

## Price
`priceBounty(amountXof)` (`pricing.ts`): bounty + 5% fee + 3% exchange-rate buffer, each rounded up to whole FCFA. `BitnobRates` converts with `GET /api/exchange-rates` (USDT → XOF / NGN) and `GET /api/trading/prices` (BTC → USDT), cached 60 s, rounded up to whole sats or naira.

## Lightning
- The amount comes from the bounty in `bountyRepo`, never from the caller. Only an `unfunded` bounty gets an invoice.
- Bitnob needs a customer per invoice: `BitnobFunderCustomers` creates one per funder and remembers it.
- `invoice()` reuses the open invoice while it has more than 1 min left, else creates one (`reference: fund-<bountyId>-<n>`, 15 min expiry). Concurrent calls share one Bitnob call.
- Bitnob has no Lightning webhook: watched invoices are polled every 3 s, all pending ones every 30 s. A replaced invoice is still watched, so money that arrives is never ignored.
- `store.markPaid()` is atomic. The first paid invoice of a bounty emits `funding.paid`; any later payment goes to `credit()` (the funder's balance) instead.
- Delivery is at least once (outbox): if `emit` fails, the row stays un-notified and the next poll re-delivers it. `applyFundingPaid` and `transition()` make a repeat harmless.
- With sandbox keys, `/funded` on the issue (or `POST /api/bounties/:id/funding/simulate`) settles the open invoice through Bitnob's `simulate-payment`.
- The funding store is **in memory**: a restart forgets pending invoices. A Postgres store needs new columns on `fundings` first.

## Naira (sandbox only)
- One virtual account per bounty (a Bitnob customer with KYC fields, `country_code: NGA`), asking for bounty + fee + buffer in whole naira, at least ₦500.
- Deposits add up, each reference counted once. Bounties above `maxNaira` (default ₦5M) are refused up front.
- Once covered: one NGN → BTC trade (quote then order `ngn-<fundingId>-<n>`), compare-and-set `collecting → converting → converted`, then `funding.paid` with `rail: "ngn"`. Only an expired quote is re-quoted; `resume()` re-sends the stored reference, so it never sells twice.
- Over-deposits and late deposits are credited to the funder.

## Sandbox checks
```sh
pnpm --filter @bitbounty/server lightning:smoke -- 1000   # invoice for 1000 FCFA, waits for payment
pnpm --filter @bitbounty/server ngn:smoke -- 300          # virtual account, simulated deposits, NGN→BTC order
```
Both refuse to run unless `whoami` says `sandbox`. Results: [docs/bitnob-api.md](../../../../docs/bitnob-api.md).

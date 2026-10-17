# Funding (B1 Lightning, B4 naira)

Turns a bounty from `unfunded` to `funded`: collect the money on Bitnob, then emit `funding.paid` **once per bounty**.

## Price
`priceBounty(amountXof)`: bounty + **5% fee** + **3% exchange-rate buffer**, each rounded up, whole FCFA. Converted with `BitnobRates` (USDT→XOF and USDT→NGN from `GET /api/exchange-rates`, BTC→USDT from `GET /api/trading/prices`, cached 60 s), rounded up to whole sats / naira.

## Lightning (B1)
```ts
const lightning = new LightningFunding({ client, store, rates, customers, emit, credit });
const f = await lightning.invoice({ bountyId, amountXof, funderId }); // W3 shows f.paymentRequest (BOLT11)
lightning.watch(f.id);          // fund page open → checked every 3 s
lightning.startPolling();       // watched every 3 s, all pending every 30 s (Bitnob has no Lightning webhook)
```
- Bitnob needs a customer per invoice: `BitnobFunderCustomers` creates one per funder and remembers it.
- `invoice()` returns the open invoice while it has more than 1 min left, otherwise creates a new one (`fund-<bountyId>-<n>`). A funded bounty refuses new invoices (`ALREADY_FUNDED`).
- A replaced invoice is no longer shown but **still watched**: money that arrives is never ignored.
- `store.markPaid()` is atomic and tells whether this is the bounty's first paid funding. First → `funding.paid`. Any later one (old invoice paid too, same invoice reported twice) → no event; the extra goes to `credit(funding, reason)` for the funder's balance.

Sandbox: `pnpm --filter @bitbounty/server lightning:smoke -- 1000` prints a BOLT11 and polls it.

## Naira from Lagos (B4)
```ts
const ngn = new NgnFunding({ client, fundings, accounts, rates, customers, emit, credit });
const { account } = await ngn.account({ bountyId, amountXof, funderId }, kycIdentity); // W3 "Bank transfer" tab
ngn.register(bitnobDispatcher);   // B5: virtual_account.deposit.success → handleDeposit()
await ngn.resume();               // on boot
await ngn.simulateUntilFunded(fundingId); // sandbox only: ₦1,000 per simulated transfer
```
- One naira virtual account per bounty (Bitnob customer with KYC fields, `country_code: NGA`), asking for bounty + fee + buffer in whole naira, at least ₦500 (trading minimum).
- Deposits add up; each deposit reference counts once (webhook and simulate response can report the same one).
- Bounties above `maxNaira` (default ₦5M; the sandbox balance caps quotes at a few thousand naira) are refused up front with `AMOUNT_TOO_LARGE`.
- Once the total is covered: **sell NGN for BTC** (Bitcoin as the bridge to the XOF payout) with a fresh quote and order `ngn-<fundingId>-<n>`. Quotes with less than 3 s left are not used. Only an **expired quote** gets a new quote (up to 3); any other refusal (`INVALID_AMOUNT`, `INSUFFICIENT_FUNDS`…) stops with `lastError`, back to collecting, and `simulateUntilFunded` stops depositing.
- The reference and quote are saved before ordering. Network error / 5xx → reference kept, state stays `converting`; `resume()` re-POSTs the same reference (idempotent at Bitnob) and only moves to `n+1` when that quote is refused as expired, so it never sells twice. A `pending` order keeps its id and is checked by id on resume; `funding.paid` only for a filled order.
- Exactly one conversion per account (compare-and-set `collecting → converting → converted`); then `funding.paid` with `rail: "ngn"`.
- Deposit on an account tied to no bounty → nothing funded, logged for manual reconciliation. Over-deposit (sold with the rest) or deposit after funding → `credit()` to the funder. A deposit landing *during* the conversion is not sold; it is credited once when the conversion finishes (or sold on the retry if it fails).
- Crash after the order: `resume()` re-POSTs the stored reference (or GETs by order id) and finishes without ordering twice. Crash between `converted` and `markPaid`: `resume()` marks it paid and emits then (markPaid is compare-and-set, so once).
- `BitnobFunderCustomers`: a request with KYC fields gets a KYC customer, even if Lightning already created an email-only one for that funder (that one would get 400 `missing bvn` on the virtual account).

Sandbox: `pnpm --filter @bitbounty/server ngn:smoke -- 300`.

## Not wired yet
Not instantiated in `app.ts`: `POST /api/bounties/:id/funding {rail}` needs the bounty from Postgres (F3). The Drizzle `FundingStore.markPaid` must stay atomic (`UPDATE … WHERE status <> 'paid' RETURNING`, then check for another paid row in the same transaction).

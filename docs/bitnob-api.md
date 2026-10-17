# Bitnob API — cheat sheet

Read 02 10 2026 from https://bitnob.dev (docs.bitnob.co in their links doesn't resolve; same paths work on bitnob.dev).
LLM-friendly index: https://bitnob.dev/llms.txt. Every reference page has "Copy for LLM" and a live "Try it out".

## Basics
- **Base URL:** `https://api.bitnob.com` for both sandbox and production. The **secret** decides the environment (same Client ID).
- **Auth (HMAC):** headers `x-auth-client`, `x-auth-timestamp` (**Unix seconds**), `x-auth-nonce` (16 random bytes hex, fresh per request), `x-auth-signature`.
  Signature = hex HMAC-SHA256 of `CLIENT_ID:TIMESTAMP:NONCE:BODY` keyed with the client secret. `BODY` is the exact compact JSON string sent, or empty when there is no body (GET, simulate-deposit).
  `GET /api/whoami` checks the keys and returns `environment: sandbox|production`. Implemented in `packages/bitnob` (F5).
- **Wallet Infrastructure (Enterprise)** is a separate API: `https://api.platform.bitnob.com`, `X-API-Key` header. It probably needs an enterprise account (to check).
- **SDKs:** Node, Python and Go are all marked "coming soon". Raw HTTP only.
- **Sandbox:** no KYC needed, default limits, data resets now and then. Deposits to quote addresses/invoices can be simulated, and webhooks fire as in production.
- **Idempotency:** almost every write takes a `reference`. Retrying with the same one returns the original.
- **Webhooks:** HMAC SHA512 in `x-bitnob-signature`, from IPs 18.171.51.218 and 13.134.154.133. Use ngrok locally.

## Products and endpoints

**Balances / transactions**: `GET /api/balances`, `/api/balances/:currency`, `GET /api/transactions`, `/api/transactions/:id`

**Lightning** (sats, 1 to 20M per invoice, default expiry 24h)
- `POST /api/lightning/invoices` {customer_id, amount, description, expiry, reference}, **all required** per the v2 OpenAPI spec (so create a Bitnob customer per funder first), which returns a BOLT11 `request` and a `payment_hash`
- `GET /api/lightning/invoices[/:id]`: **no Lightning webhook.** Poll until `status=paid`. The `preimage` is the proof of payment.
- `POST /api/lightning/decode`: inspect an invoice
- `POST /api/lightning/pay` {request, reference, max_fee?}, which returns a `preimage`. Payments are final. Pay without a fee cap only on purpose.
- No `description_hash` field on invoice creation, which matters for LNURL-pay (see ideas).
- LNURL and Lightning Addresses: documented as **"coming soon"**.

**Payouts** (crypto → local fiat): quote → initialize → finalize
- `POST /api/payouts/quotes` {from_asset BTC|USDT|USDC, to_currency, country, amount | settlement_amount, source offchain|onchain, chain?, reference}. Quotes expire in about 15 min.
- `POST /api/payouts/:quoteId/initialize` {beneficiary {destination_type bank|mobile_money|swift, account_number, account_name, bank_code}, payment_reason, callback_url?}
- `POST /api/payouts/:quoteId/finalize`
- **Two funding models:** *wallet-funded* (`offchain`, debits our balance) or *on-the-fly*, where initialize returns a **BTC address / Lightning invoice / USDT address for the payer to fund**, then Bitnob pays out.
- Helpers: `GET /api/payouts/supported-countries[/:country]`, `/banks/:countryCode`, `/limits`, `/account-lookup` (name check, **NG and GH only**)
- Webhooks: `payouts.initialized`, `payouts.processing`, `payouts.withdrawal.success`, `payouts.withdrawal.expired`
- **Senegal (XOF): mobile money only, through Orange Money, Free Money, Expresso and Wave.** Also Ivory Coast, Niger, plus GH, KE, NG, UG, GM, RW, XAF countries, and USD over ACH, wire and SWIFT.
- Bulk transfers: `POST /api/bulk-transfers` (CSV/XLSX upload + preview + confirm + retry)

**Stablecoins / addresses / withdrawals**
- `POST /api/addresses` (deposit address per customer, multi-chain), `POST /api/addresses/validate`, `GET /api/stablecoins/supported-chains`
- `POST /api/withdrawals` (on-chain send; stablecoin minimum $10)
- Webhooks: `deposit.success`, `transfer.success`, `transfer.failed`

**Trading**
- `GET /api/trading/prices`, `POST /api/trading/quotes`, `POST /api/trading/orders`
- `POST /api/trading/scheduled-orders`: **DCA** (daily/weekly/monthly, pause/resume, execution history)
- `POST /api/trading/target-orders`: **limit-style**, funds held in escrow until the price triggers
- `GET /api/exchange-rates`, `/api/exchange-rates/convert`

**Virtual cards** (USD, amounts in micro-units: 1 USD = 1,000,000)
- `POST /api/cards/kyc` first (async, enabled per account), then `POST /api/cards`
- `POST /api/cards/:id/balance` {type fund|withdraw}, `POST /api/cards/:id/status` {frozen|active}, `PUT /api/cards/:id/spend-limits` (per tx/day/week/month/year/lifetime), `POST /api/cards/:id/terminate`
- Transaction webhooks (authorization, settlement, declined, refund…). They are notifications only: **no live approve/decline hook**. `POST /api/cards/:id/simulate-webhook` exists for tests.

**Virtual accounts**: dedicated **NGN** bank accounts per customer (Nigeria only). Sandbox can simulate deposits.

**Customers / beneficiaries**: `/api/customers`, `/api/beneficiaries` (CRUD)

**Wallet Infrastructure (Enterprise)**: vaults (HD seeds) → wallets (per chain) → addresses. Keys sit in AWS Nitro enclaves.
**Policy engine** (whitelist, limits, multi-approval, velocity, quorum) runs *before* signing. Gas stations sponsor fees (Tron USDT is close to free), plus on-chain address subscriptions and JSON-RPC proxy.

## Gaps (= things Bitnob would value)
- No inbound XOF: nobody can pay *in* with Wave or Orange Money. Money enters as BTC, Lightning, USDT/USDC, or NGN.
- LNURL / Lightning Address: "coming soon".
- Official SDKs: "coming soon".
- No Lightning webhooks: polling only.
- Account name lookup doesn't cover Senegal.

## To check on Saturday: "creators / community" API (17 10 2026)
Jib mentioned an API section aimed at creators / communities, to use for the jury.
- Not found in the public docs (bitnob.dev, llms.txt, sitemap). The **"Marketplace"** section exists but is empty, and **"Bounties"** is just the Genesis intro.
- Nearby, publicly: the tutorial [Building a Tipping Platform with Bitnob API](https://bitnob.com/en-US/resources/blog/building-a-tipping-platform-with-bitnob-api) (tip a user by email: Lightning invoice + BTC address per customer).
- Ask at the 11:00 workshop: is there a creators/community product (or an upcoming Marketplace)? If so, plug it in (e.g. a public page/tip per developer, sponsoring a community).

## F5: client and sandbox results (17 10 2026)
Client: `packages/bitnob` (`BitnobClient`). Signs every request, retries network errors / 429 / 5xx (2 extra attempts by default, **new timestamp + nonce + signature on every attempt**), never retries a 4xx, and turns every failure into a `BitnobError` (`status`, `code`, `detail`, `correlationId`) that never contains the secret.
Both error shapes are handled: RFC 7807 (`code`, `detail`) and validation (`{success:false, error:{code, message}}`).

Run the 4 key calls against the sandbox:
```bash
# BITNOB_CLIENT_ID / BITNOB_CLIENT_SECRET in the repo-root .env (see .env.example)
cd packages/bitnob && pnpm install && pnpm smoke
```
The script prints the raw responses and a summary table to paste below.

What the spec says, before the run:
- Lightning invoice needs a `customer_id` (the script creates a customer first).
- Payout quote: the spec lists `amount` as required but its example uses `settlement_amount` (what the beneficiary receives). We send `settlement_amount` in XOF. SN mobile money `bank_code`s come from `GET /api/payouts/banks/SN`.
- `simulate-deposit` takes **no body**; the sandbox credits a fixed amount (₦1,000 per call per our notes, spec example shows 100000 kobo).
- Trading quote: `side` is upper case (`BUY`/`SELL`), `quantity` a string in major units. The spec's NGN example is NGN→USDT; the script tries NGN→BTC and NGN→USDT.

| Call | Result | Notes |
| --- | --- | --- |
| whoami | _not run yet_ | needs sandbox keys |
| 1. Lightning invoice | _not run yet_ | |
| 2. SN payout quote | _not run yet_ | |
| 3. NGN virtual account + simulate deposit | _not run yet_ | |
| 4. NGN→BTC quote | _not run yet_ | |

## B5: webhook receiver
`POST /webhooks/bitnob` on `apps/server` (`src/bitnob/`), mounted when `BITNOB_WEBHOOK_SECRET` is set (503 otherwise).
1. Checks `x-bitnob-signature` = hex HMAC-SHA512 of the **raw** body keyed with `BITNOB_WEBHOOK_SECRET` (constant-time; `sha512=` prefix tolerated). Bad or missing → **401**, nothing stored.
2. Reads the envelope: `event_id` (or `eventId`) and `event` (or `eventType`). Missing → 400.
3. Stores it once in the shared `events` table (`source = "bitnob"`, `external_id = event_id`). Same `event_id` again → 200 `{duplicate:true}`, not dispatched again.
4. Dispatches on the event name: `bitnobDispatcher.on("payouts.withdrawal.success", handler)` (exported from `src/app.ts`). A handler that throws → 500 and the row is `failed`; Bitnob retries non-200 three times and the retry is processed again.
Helpers: `toPayoutUpdate(env)` → `{bitnobPayoutId, quoteId, reference, outcome: quote|initiated|processing|success|failed}` (`expired` = failed); `toDepositUpdate(env)` → `{virtualAccountId, reference, amountMinor (kobo), currency}`.

**Ordering and replays.** Bitnob doesn't sign a timestamp, so an old event can't be told apart from a late one by the signature: the dedupe on `event_id` stops exact replays, and the **handlers own the state** (a `payouts.processing` arriving after `success` must be ignored: a paid payout is terminal in the state machine).

**Dashboard setup.** Paramètres → Webhooks: URL `https://<server>/webhooks/bitnob` (ngrok in local dev: `ngrok http 8787`), copy the secret into `.env` as `BITNOB_WEBHOOK_SECRET`. Payout initialize also takes a per-payout `callback_url`.

**Polling fallback** (Lightning has no webhooks at all, and sandbox webhooks may not fire): `GET /api/payouts/:id` returns the same status (`QUOTE`, `INITIATED`, `processing`, `success`, `expired`…). Pass it through `toPayoutOutcome()` and feed the result to the same handler as the webhook. B2 polls payouts that stay `processing`; B1 polls Lightning invoices.

## B2: payout pipeline
`apps/server/src/payouts/` (see its README): quote → initialize → finalize with retries, idempotency and crash recovery. Client calls added in `packages/bitnob`: `initializePayout(quoteId, {reference, beneficiary, callback_url})` (`callback_url` is required by the spec), `finalizePayout(quoteId)` (no body, irreversible), `getPayout(id)` (`id` = the payout id returned by the quote, not the quote id).
Sandbox run: `pnpm --filter @bitbounty/server payout:smoke -- <+221…> wave "<name>" 137`. Result: _not run yet (needs sandbox keys)_.

## B1: Lightning funding
`apps/server/src/funding/` (see its README). Calls: `POST /api/customers` (once per funder, invoices need `customer_id`), `POST /api/lightning/invoices` (sats, `reference: fund-<bountyId>-<n>`, expiry 900 s), `GET /api/lightning/invoices/:id` polled (no Lightning webhook). Rates: `GET /api/exchange-rates?from=USDT&to=XOF`, `GET /api/trading/prices?base_currency=BTC&quote_currency=USDT` (new client methods `getExchangeRate`, `getTradingPrice`).
Invoice statuses we read: `paid`/`settled` → paid, `expired`/`cancelled` → expired, anything else pending. To confirm against the sandbox: `pnpm --filter @bitbounty/server lightning:smoke -- 1000`. Result: _not run yet_.

## B4: naira funding from Lagos
`apps/server/src/funding/ngn.ts`. Calls: `POST /api/customers` (KYC fields, `country_code: NGA`), `POST /api/virtual-accounts` (`reference: va-<bountyId>-<n>`), `POST /api/virtual-accounts/:id/simulate-deposit` (sandbox, no body), `POST /api/trading/quotes` NGN→BTC `SELL`, whole naira, ≥ ₦500, then `POST /api/trading/orders` with `quote_id` and `reference: ngn-<fundingId>-<n>`. Deposits arrive by webhook `virtual_account.deposit.success` (B5) or in the simulate response.
On resume: `GET /api/trading/orders/:id` with the **order id** only, or re-POST the stored reference + quote (idempotent: the same reference returns the existing order).

Sandbox results (2026-10-17, `environment=sandbox`):
| Call | Result |
| --- | --- |
| `ngn:smoke` end to end (review of #65) | ₦1,000 simulated deposit → NGN→BTC order `filled` → `funding.paid` |
| VA without KYC (email-only customer) | 400 `missing bvn…`: the customer needs KYC fields (`id_type: bvn`, `id_number`) |
| `simulate-deposit` | ₦1,000 (`amount: "100000"` kobo) per call |
| NGN→BTC quote ₦1,000 | OK, `expires_at` 30 s ahead, receive ≈ 0.00000896 BTC |
| quote ₦100 | 400 `INVALID_AMOUNT`: amount below configured minimum |
| quote ₦999,999,999 | 400 `INVALID_AMOUNT`: amount above configured maximum |
| quote ≈ ₦4,000+ | 422 `INSUFFICIENT_FUNDS`: insufficient balance. Sandbox caps quotes at the company-wide NGN balance (≈ ₦3,980 that day) |
| `GET /api/trading/orders/<reference>` | 400 `VALIDATION_ERROR: invalid id`: only the order id works |

Only an expired quote is re-quoted; `INVALID_AMOUNT` / `INSUFFICIENT_FUNDS` stop the conversion with `lastError` (no loop). `NgnFunding({ maxNaira })` refuses bounties above the cap up front.
Sandbox run: `pnpm --filter @bitbounty/server ngn:smoke -- 300`.

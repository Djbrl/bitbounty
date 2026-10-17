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
# From a git worktree (no .env there), point at the main checkout's file:
pnpm smoke --env-file /path/to/bitbounty/.env
```
`--env-file` (or `--env-file=<path>`) loads that file; variables already set in the shell win. The script runs `whoami` first and stops unless it says `environment=sandbox` (`--allow-production` to override). It prints the raw responses and a summary table to paste below. The client retries a 429 after its `Retry-After` delay (seconds or HTTP date, capped at 30 s), and keeps the secret in a `#private` field so `inspect()` / `JSON.stringify()` of a client never show it.

What the spec says, before the run:
- Lightning invoice needs a `customer_id` (the script creates a customer first).
- Payout quote: the spec lists `amount` as required but its example uses `settlement_amount` (what the beneficiary receives). We send `settlement_amount` in XOF. SN mobile money `bank_code`s come from `GET /api/payouts/banks/SN`.
- `simulate-deposit` takes **no body**; the sandbox credits a fixed amount (₦1,000 per call per our notes, spec example shows 100000 kobo).
- Trading quote: `side` is upper case (`BUY`/`SELL`), `quantity` a string in major units. The spec's NGN example is NGN→USDT; the script tries NGN→BTC and NGN→USDT.

Sandbox run, 17 10 2026 20:40 UTC (`pnpm smoke --env-file …`, keys of the "bitnob hackathon" sandbox app):

| Call | Result | Notes |
| --- | --- | --- |
| whoami | OK | bitnob hackathon, environment=sandbox |
| customer (payer) | OK | id=01a14b97-b61d-7cd6-adc0-d643b7a1e28a |
| 1. lightning invoice | OK | id=01a14b97-b6a9-7fa0-b3fc-3836b983fa04 status=pending bolt11=lntb10u1p4d8hgupp5g6p0nu… |
| 1b. get lightning invoice | OK | status=pending |
| 2a. SN providers | OK | none listed (sandbox returns banks: null) |
| 2. SN payout quote from USDT | OK | quote_id=QT2_21052948 sends 0.232397 USDT for 137 XOF, fees=0, expires 2026-10-17T20:55:56Z |
| 2. SN payout quote from BTC | OK | quote_id=QT2_21052949 sends 0.00000284 BTC for 137 XOF, fees=0, expires 2026-10-17T20:45:57Z |
| customer (Lagos funder) | OK | id=01a14b66-4be9-73a7-b8bf-902141d1a9c0 |
| 3a. NGN virtual account | OK | id=01a14b97-ba92-75d4-8777-4ce448ec019f Sandbox Bank 900023453543 |
| 3. simulate deposit #1 | OK | credited 100000 kobo (completed), new_balance not returned |
| 4. NGN→BTC quote | OK | 1000 NGN → 0.00000896 BTC, expires after 30 s |
| 4. NGN→USDT quote | OK | 1000 NGN → 0.7311985267008806 USDT, expires after 30 s |

What the run taught us:
- **No SN `bank_code` in the sandbox.** `GET /api/payouts/banks/SN` answers `banks: null` (the client returns `[]`). B2's `POST /api/payouts/:quoteId/initialize` needs `beneficiary.bank_code` for `mobile_money`, so in the sandbox B2 can't take the Wave / Orange Money codes from this endpoint: it needs a configured fallback (to confirm with Bitnob at the workshop), or initialize will be refused.
- The SN payout quote works from both USDT and BTC, with `fees=0` in the sandbox. Observed lifetimes: about 16 min (USDT) and 6 min (BTC), so B2 must re-quote rather than assume 15 min.
- `simulate-deposit` credits a fixed **100000 kobo (₦1,000)** per call and returns `new_balance: ""`. The smoke script adds up the credits itself and deposits until they cover the quote.
- NGN trading quotes use `quantity: "1000"` (₦1,000 = one deposit); the earlier `"5000"` was more than the sandbox balance. They expire after 30 s.

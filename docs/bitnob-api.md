# Bitnob API — cheat sheet

Read 02 10 2026 from https://bitnob.dev (docs.bitnob.co in their links doesn't resolve; same paths work on bitnob.dev).
LLM-friendly index: https://bitnob.dev/llms.txt. Every reference page has "Copy for LLM" and a live "Try it out".

## Basics
- **Base URL:** `https://api.bitnob.com` for both sandbox and production. The **secret** decides the environment (same Client ID).
- **Auth (HMAC):** headers `x-auth-client`, `x-auth-timestamp` (ms), `x-auth-nonce` (UUID), `x-auth-signature`.
  The signature is HMAC-SHA256 over the fields joined by colons, keyed with the client secret. Exact field order is on the Authentication page.
  `GET /api/whoami` checks the keys.
- **Wallet Infrastructure (Enterprise)** is a separate API: `https://api.platform.bitnob.com`, `X-API-Key` header. It probably needs an enterprise account (to check).
- **SDKs:** Node, Python and Go are all marked "coming soon". Raw HTTP only.
- **Sandbox:** no KYC needed, default limits, data resets now and then. Deposits to quote addresses/invoices can be simulated, and webhooks fire as in production.
- **Idempotency:** almost every write takes a `reference`. Retrying with the same one returns the original.
- **Webhooks:** HMAC SHA512 in `x-bitnob-signature`, from IPs 18.171.51.218 and 13.134.154.133. Use ngrok locally.

## Products and endpoints

**Balances / transactions**: `GET /api/balances`, `/api/balances/:currency`, `GET /api/transactions`, `/api/transactions/:id`

**Lightning** (sats, 1 to 20M per invoice, default expiry 24h)
- `POST /api/lightning/invoices` {amount, description, reference, expiry?, customer_id?}, which returns a BOLT11 `request` and a `payment_hash`
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

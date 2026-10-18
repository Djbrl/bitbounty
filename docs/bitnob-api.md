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
- `POST /api/lightning/decode` {request}: inspect an invoice. Seen live: `{payment_hash, destination, amount_sat, amount_msat, description, expires_at (unix s, string), is_expired}`
- `POST /api/lightning/pay` {customer_id, request, reference, max_fee}, all four **required** per the v2 spec, "**idempotent on `reference`**", returns a `preimage`. Payments are final. **Our sandbox account answers `403 FEATURE_NOT_ENABLED` (`feature_key: send_lightning`)**, also for `POST /api/lightning/preview` (2026-10-18). See B6.
- No `description_hash` field on invoice creation, which matters for LNURL-pay (see ideas).
- LNURL and Lightning Addresses: documented as **"coming soon"**, so B6 resolves them itself (LNURL-pay → BOLT11 → `/lightning/pay`).

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
- Payout quote: the spec lists `amount` as required but its example uses `settlement_amount` (what the beneficiary receives). We send `settlement_amount` in XOF. SN mobile money `bank_code`s come from `GET /api/payouts/banks/SN`, **but the sandbox answers `{"banks":null}` for SN** (seen live). Fallback: `BITNOB_SN_BANK_CODES='{"wave":"…","orange":"…"}'`. No defaults: **confirm the real Wave / Orange Money SN codes with Bitnob at the workshop**.
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

## B5: webhook receiver
`POST /webhooks/bitnob` on `apps/server` (`src/bitnob/`), mounted when `BITNOB_WEBHOOK_SECRET` is set (503 otherwise).
1. Checks `x-bitnob-signature` = hex HMAC-SHA512 of the **raw** body keyed with `BITNOB_WEBHOOK_SECRET` (constant-time; `sha512=` prefix tolerated). Bad or missing → **401**, nothing stored.
0. Bodies over 256 KiB → **413** before anything else.
2. Reads the envelope: `event_id` (or `eventId`) and `event` (or `eventType`). Missing → 400. A body with only a top-level `id` is keyed `<event>#<id>`, so the same resource id on two event types can't collide.
3. Stores it once in the shared `events` table (the same `eventStore` as `/webhooks/github`: Postgres when `DATABASE_URL` is set) (`source = "bitnob"`, `external_id = event_id`). Same `event_id` again → 200 `{duplicate:true}`, not dispatched again.
4. Dispatches on the event name: `bitnobDispatcher.on("payouts.withdrawal.success", handler)` (exported from `src/app.ts`). A handler that throws → 500 and the row is `failed`; Bitnob retries non-200 three times and the retry is processed again.
Helpers: `toPayoutUpdate(env)` → `{bitnobPayoutId, quoteId, reference, outcome: quote|initiated|processing|success|failed}` (`expired` = failed; `payouts.initialized` with no status = initiated); `toDepositUpdate(env)` → `{kind, virtualAccountId, reference, amountMinor, currency}`.
- `kind: "ngn_virtual_account"` for `virtual_account.deposit.success` (naira, B4); `kind: "stablecoin"` for `deposit.success` (USDT/USDC to an address, **not naira**; currency comes from `data.currency`/`data.asset`, never defaulted).
- `amountMinor` = Bitnob's major-unit decimal string parsed exactly by `toMinorUnits(amount, currency)` (`"1000.50"` NGN → 100050 kobo; USDT/USDC 6 decimals, BTC 8, XOF 0). Null for an unknown currency, too many decimals, or a non-decimal value.

**Stuck rows.** If the server dies between storing and finishing a dispatch, the row stays `received` and redeliveries are answered as duplicates. Those are recovered by the polling below, not by the webhook.

**Ordering and replays.** Bitnob doesn't sign a timestamp, so an old event can't be told apart from a late one by the signature: the dedupe on `event_id` stops exact replays, and the **handlers own the state** (a `payouts.processing` arriving after `success` must be ignored: a paid payout is terminal in the state machine).

**Dashboard setup.** Paramètres → Webhooks: URL `https://<server>/webhooks/bitnob` (ngrok in local dev: `ngrok http 8787`), copy the secret into `.env` as `BITNOB_WEBHOOK_SECRET`. Payout initialize also takes a per-payout `callback_url`.

**Polling fallback** (Lightning has no webhooks at all, and sandbox webhooks may not fire): `GET /api/payouts/:id` returns the same status (`QUOTE`, `INITIATED`, `processing`, `success`, `expired`…). Pass it through `toPayoutOutcome()` and feed the result to the same handler as the webhook. B2 polls payouts that stay `processing`; B1 polls Lightning invoices.

### How to verify live (done-when for B5, not yet run)
Needs dashboard access to the Bitnob sandbox account, and a server running this branch (the Docker `server` image must be rebuilt after merge).
1. Bitnob dashboard (sandbox) → Paramètres → Webhooks: URL `https://kruger-alerts-platform-must.trycloudflare.com/webhooks/bitnob` (the quick tunnel URL changes when the `tunnel` container restarts: `docker compose logs tunnel | grep trycloudflare`).
2. Copy the webhook secret shown there into the repo-root `.env` as `BITNOB_WEBHOOK_SECRET`, then restart the server (`docker compose up -d server`). Without it the route answers 503.
3. Trigger an event: simulate a deposit on a sandbox virtual account (`pnpm smoke` in `packages/bitnob`), or a test-webhook button if the dashboard has one.
4. Check it was verified and stored (a bad signature is 401 and stores nothing, so a row proves the HMAC matched):
```bash
docker compose exec db psql -U postgres -d bitbounty -c \
  "select id, external_id, type, status, error, received_at from events where source = 'bitnob' order by id desc limit 5;"
```
Expect a row with `status = processed`. Server log on a mismatch: `[bitnob] rejected webhook: bad or missing signature`.

## B6: Lightning payouts (replaces B2's mobile money rail)
`apps/server/src/payouts/` (see its README). The developer's Lightning Address is resolved by us (LNURL-pay, LUD-06/16): `GET https://<domain>/.well-known/lnurlp/<user>` → `GET <callback>?amount=<msat>` → BOLT11, decoded locally and refused unless the amount is exactly what we asked, the network is ours (`LIGHTNING_NETWORK`, testnet by default = sandbox `lntb…`), it has ≥ 120 s left and its description hash matches. Then `POST /api/lightning/pay {request, reference: "pay-<bountyId>-<attempt>", max_fee, customer_id?}` sent **once** (`{ retries: 0 }`). New client methods: `payLightningInvoice`, `getLightningPayment` (reads `/api/lightning/invoices/:id`, unverified for outgoing payments), `decodeLightningInvoice`.

Amount: `floor(amountXof × 1e8 / (FCFA per USDT × USDT per BTC))` sats, the same rates as B1, stored on the payout row (`amount_sats`, `xof_per_btc`) for the receipt.

After an unclear answer (timeout, 5xx, 409) the payment may have gone through: we read it by id, or replay the **same reference with the same invoice** (Bitnob: idempotent on `reference`; Lightning: one payment hash settles once). A new attempt (new invoice, new reference) only after Bitnob says the previous one failed.

Sandbox proof (`pnpm --filter @bitbounty/server payout:smoke`, aborts unless `whoami` says sandbox): a local LNURL-pay server plays the developer's wallet and returns **Bitnob sandbox invoices** (`POST /api/lightning/invoices`) for the exact amount asked. Result (2026-10-18):
- proven live: whoami sandbox, rates → sats rounded down, LNURL-pay against the local receiver, a real Bitnob `lntb` invoice decoded by us exactly like `/lightning/decode` (amount_msat, payment_hash, expires_at), an invoice for 1 sat more refused with nothing paid, the pay call sent once with `pay-<bountyId>-1` even with 3 simultaneous triggers;
- **blocked: `POST /api/lightning/pay` → `403 FEATURE_NOT_ENABLED` "The Lightning withdrawals feature is currently not available"** (`feature_key: send_lightning`) on our sandbox company. Nothing is debited (BTC balance unchanged). Ask Bitnob to enable `send_lightning` on the sandbox, then rerun the smoke script: it prints the receiving invoice's status (`paid`) and the balance delta.

## B2: payout pipeline (mobile money, superseded by B6)
Payouts no longer use this rail (the mentor confirmed Wave / Orange Money payouts won't work); B3's test payout still calls these endpoints. `apps/server/src/payouts/rails.ts`: quote → initialize → finalize with retries, idempotency and crash recovery. Client calls added in `packages/bitnob`: `initializePayout(quoteId, {reference, beneficiary, callback_url})` (`callback_url` is required by the spec), `finalizePayout(quoteId, { retries: 0 })` (no body, irreversible, **always sent once**: a replay of a finalize that went through answers 409/422 "already finalized"), `getPayout(id)` (`id` = the payout id returned by the quote, not the quote id).

(Sandbox, aborts unless `whoami` says `environment=sandbox`; Bitnob also whitelists caller IPs, a non-whitelisted IP gets `403 IP address not whitelisted`.)
The mobile money `payout:smoke` script was replaced by B6's Lightning one. Result: never run (blocked on the SN bank codes, then abandoned).

## B1: Lightning funding
`apps/server/src/funding/` (see its README). Calls: `POST /api/customers` (once per funder, invoices need `customer_id`), `POST /api/lightning/invoices` (sats, `reference: fund-<bountyId>-<n>`, expiry 900 s), `GET /api/lightning/invoices/:id` polled (no Lightning webhook). Rates: `GET /api/exchange-rates?from=USDT&to=XOF`, `GET /api/trading/prices?base_currency=BTC&quote_currency=USDT` (new client methods `getExchangeRate`, `getTradingPrice`).
Invoice statuses we read: `paid`/`settled` → paid, `expired`/`cancelled` → expired, anything else pending. To confirm against the sandbox: `pnpm --filter @bitbounty/server lightning:smoke -- 1000`. Result (2026-10-17): rates OK, 1000 FCFA → 2218 sats, invoice created with a 15-min testnet BOLT11 (`lntb…`), polled `pending`. Paying it (testnet wallet, by a human) is still to do. A duplicate `reference` returns `409 DUPLICATE_KEY_ERROR`.

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

## F7: sandbox proxy for the team
Bitnob only answers whitelisted IPs, and the sandbox keys live on the always-on Mac. The Docker server there exposes `/dev/bitnob/*`: send your Bitnob **sandbox** calls to it with the team token, it re-signs them with its own keys and forwards them from the whitelisted IP. You don't need any Bitnob key.

**Teammate setup.** Put these 3 lines in your repo-root `.env` (leave `BITNOB_CLIENT_ID` / `BITNOB_CLIENT_SECRET` empty):
```bash
BITNOB_BASE_URL=https://kruger-alerts-platform-must.trycloudflare.com/dev/bitnob
BITNOB_PROXY_TOKEN=<ask Djbrl>
BITNOB_PROXY_USER=<your first name>   # shown in the proxy's log, optional
```
`readBitnobConfig()` then returns a proxy-mode config and `BitnobClient` works unchanged: it sends `Authorization: Bearer <BITNOB_PROXY_TOKEN>` (+ `X-Dev-User`) and **skips its own HMAC signing**. Every smoke script works as is (`pnpm smoke` in `packages/bitnob`, `pnpm --filter @bitbounty/server lightning:smoke -- 1000`). By hand:
```bash
curl -H "authorization: Bearer $BITNOB_PROXY_TOKEN" "$BITNOB_BASE_URL/api/whoami"
```
The quick-tunnel URL changes when the `tunnel` container restarts (`docker compose logs tunnel | grep trycloudflare`): update `BITNOB_BASE_URL` then.

**Server side** (`apps/server/src/dev/bitnob-proxy.ts`), mounted only when `DEV_PROXY_TOKEN` is set in the server's `.env` (otherwise `/dev/bitnob/*` is 404). Rotate the token by changing it and restarting the server.
- Token: `Authorization: Bearer <DEV_PROXY_TOKEN>`, constant-time compare (both sides SHA-256 hashed, then `timingSafeEqual`). Missing or wrong → **401**, checked before the body is read.
- Sandbox only: the first call runs `whoami` (cached, a failed whoami isn't); unless it says `environment=sandbox`, every call answers **403**. Production keys in `.env` → the proxy refuses everything.
- Paths: only `/api/...` on the configured `BITNOB_BASE_URL` host. `..`, encoded `%2e` / `%2f` / `%5c`, `//`, absolute URLs and anything the URL parser had to rewrite → **400** (checked on the raw request line, so `/dev/bitnob/../../x` is caught too).
- Blocklist → **403**: any path segment containing `key`, `webhook`, `setting`, `secret`, `credential`, `whitelist`, `permission` or `token`, and the segments `account(s)`, `users`, `members`, `team(s)`, `company`/`companies`, `ips`.
- Body: JSON only (400 otherwise), at most 64 KiB (**413**). Sent compact, signed with a fresh timestamp and nonce.
- One attempt, never retried (POST or not): Bitnob's status and body come back unchanged (a Bitnob 5xx stays a 5xx). Bitnob silent for 20 s → 504; unreachable → 502. Your own client retries as usual.
- Log, one line per call: `[dev-proxy] user=<X-Dev-User> POST /dev/bitnob/api/lightning/invoices -> 200 812ms`. Never the query, body, headers or token.
- Sandbox only does not mean harmless: whatever you send runs on the team's sandbox account (invoices, payouts, trading). Don't pay or finalize things you didn't mean to.

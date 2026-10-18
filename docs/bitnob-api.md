# Bitnob API notes

What we learned using the Bitnob API, read from https://bitnob.dev (LLM index: https://bitnob.dev/llms.txt) and checked against the sandbox in October 2026. Our client: [`packages/bitnob`](../packages/bitnob/README.md).

## Basics
- **Base URL:** `https://api.bitnob.com` for both sandbox and production. The **secret** decides the environment; the Client ID is the same.
- **Auth (HMAC):** headers `x-auth-client`, `x-auth-timestamp` (Unix **seconds**), `x-auth-nonce` (16 random bytes hex, fresh per request), `x-auth-signature` = hex HMAC-SHA256 of `CLIENT_ID:TIMESTAMP:NONCE:BODY` keyed with the secret. `BODY` is the exact compact JSON sent, or empty when there is none (GET, simulate-deposit). `GET /api/whoami` returns `environment: sandbox|production`.
- **IP whitelist:** Bitnob only answers whitelisted IPs; others get `403 IP address not whitelisted`.
- **Idempotency:** almost every write takes a `reference`; retrying with the same one returns the original. A duplicate Lightning invoice reference answers `409 DUPLICATE_KEY_ERROR`.
- **Errors** come in two shapes: RFC 7807 (`code`, `detail`) and validation (`{success:false, error:{code, message}}`).
- **Webhooks:** HMAC-SHA512 of the raw body in `x-bitnob-signature`. Bitnob retries non-200 answers three times.
- **SDKs** (Node, Python, Go) are listed as "coming soon": raw HTTP only.

## Endpoints we use
**Lightning** (1 to 20M sats per invoice)
- `POST /api/lightning/invoices {customer_id, amount, description, expiry, reference}`: all required per the v2 spec, so a customer (`POST /api/customers`) is created per funder first. Returns a BOLT11 `request` and a `payment_hash`. No `description_hash` field.
- `GET /api/lightning/invoices/:id`: **there is no Lightning webhook**, so we poll. Statuses read: `paid`/`settled` → paid, `expired`/`cancelled` → expired, anything else pending.
- `POST /api/lightning/invoices/:id/simulate-payment` (sandbox): marks an invoice paid; sandbox `lntb…` invoices can't be paid by real wallets.
- `POST /api/lightning/decode {request}` → `{payment_hash, destination, amount_sat, amount_msat, description, expires_at (unix s, string), is_expired}`.
- `POST /api/lightning/pay {customer_id, request, reference, max_fee}`: documented as idempotent on `reference`; payments are final.
- LNURL and Lightning Addresses are "coming soon" on Bitnob, so we resolve them ourselves (LNURL-pay, LUD-06/16).

**Rates:** `GET /api/exchange-rates?from=USDT&to=XOF` (and NGN), `GET /api/trading/prices?base_currency=BTC&quote_currency=USDT`.

**Naira:** `POST /api/virtual-accounts` (a dedicated Nigerian account per customer), `POST /api/virtual-accounts/:id/simulate-deposit` (sandbox, no body), `POST /api/trading/quotes` (`side` upper case, `quantity` a string in major units), `POST /api/trading/orders {quote_id, reference}`, `GET /api/trading/orders/:id`.

**Not used:** mobile money payouts (`/api/payouts/quotes` → `initialize` → `finalize`), stablecoin addresses, virtual cards, Wallet Infrastructure. The client still has the payout calls; BitBounty pays over Lightning instead.

## Sandbox results
| Call | Result |
| --- | --- |
| `whoami` | `environment=sandbox` |
| Lightning invoice | created (1000 FCFA → 2218 sats, 15 min `lntb…`), paid with `simulate-payment`, bounty moved to `funded` |
| `lightning/pay`, `lightning/preview` | **`403 FEATURE_NOT_ENABLED`** ("The Lightning withdrawals feature is currently not available", `feature_key: send_lightning`). Nothing debited |
| Virtual account | needs a customer with KYC fields (`id_type: bvn`, `id_number`); an email-only customer gets `400 missing bvn` |
| `simulate-deposit` | credits a fixed ₦1,000 (`100000` kobo) per call; `new_balance` comes back empty |
| NGN → BTC quote | ₦1,000 → ≈ 0.00000896 BTC, expires after 30 s. ₦100: `400 INVALID_AMOUNT` (below minimum). Above the company's NGN balance (≈ ₦4,000): `422 INSUFFICIENT_FUNDS` |
| `ngn:smoke` end to end | ₦1,000 deposit → NGN→BTC order `filled` → `funding.paid` |
| `GET /api/trading/orders/<reference>` | `400 invalid id`: only the order id works |
| `GET /api/payouts/banks/SN` | `{"banks": null}`: no Senegal mobile money codes in the sandbox |

Production: our production key is rejected with `401 Invalid HMAC` ([#86](https://github.com/Djbrl/bitbounty/issues/86)), so no real payout has been made. `pnpm --filter @bitbounty/server live-pay` is ready for it ([payouts README](../apps/server/src/payouts/README.md)).

Re-run: `pnpm smoke` in `packages/bitnob`, and `lightning:smoke`, `ngn:smoke`, `payout:smoke` in `apps/server`. All refuse to run unless `whoami` says sandbox.

## How BitBounty uses it
- **Lightning funding** (`apps/server/src/funding/lightning.ts`): customer per funder, invoice `fund-<bountyId>-<n>` with 900 s expiry, polled. [Funding README](../apps/server/src/funding/README.md).
- **Naira funding** (`apps/server/src/funding/ngn.ts`): virtual account `va-<bountyId>-<n>`, deposits, then one NGN→BTC order `ngn-<fundingId>-<n>`. On resume it reads by order id or re-sends the stored reference. Sandbox only, not wired on the server ([#168](https://github.com/Djbrl/bitbounty/issues/168)).
- **Payouts** (`apps/server/src/payouts/`): `floor(amountXof × 1e8 / (FCFA per USDT × USDT per BTC))` sats → LNURL-pay invoice from the developer's Lightning Address, checked locally (exact amount, network, ≥ 120 s left, description hash) → one `POST /api/lightning/pay` with `reference: pay-<bountyId>-<attempt>`, sent with no automatic retry. After an unclear answer it reads the payment first and only replays the same reference with the same invoice. [Payouts README](../apps/server/src/payouts/README.md).

## Webhook receiver
`POST /webhooks/bitnob` (`apps/server/src/bitnob/`), mounted when `BITNOB_WEBHOOK_SECRET` is set (503 otherwise):
1. Bodies over 256 KiB → 413.
2. `x-bitnob-signature` must be the HMAC-SHA512 of the raw body (constant-time compare, `sha512=` prefix tolerated). Otherwise 401, nothing stored.
3. Reads `event_id` (or `eventId`) and `event` (or `eventType`); missing → 400.
4. Stores it once in `events` (`source = bitnob`). The same `event_id` again → 200 `{duplicate:true}`.
5. Dispatches by event name. A handler that throws → 500 and the row is `failed`, so Bitnob's retry runs it again.

Bitnob doesn't sign a timestamp, so handlers own the ordering: a late `processing` after `success` is ignored. In the dashboard: Webhooks → `https://<server>/webhooks/bitnob`, and the secret into `.env`.

## Sandbox proxy for the team
Bitnob answers only whitelisted IPs, so a server with `DEV_PROXY_TOKEN` set exposes `/dev/bitnob/*`: teammates send sandbox calls with the token and the server re-signs them with its own keys. Client side: `BITNOB_BASE_URL=https://<server>/dev/bitnob`, `BITNOB_PROXY_TOKEN=<token>`, optional `BITNOB_PROXY_USER`, and no Bitnob keys.

Server side (`apps/server/src/dev/bitnob-proxy.ts`):
- bearer token compared in constant time; wrong or missing → 401;
- sandbox only: unless `whoami` says sandbox, every call → 403;
- only `/api/...` paths; traversal and encoded tricks → 400; paths about keys, webhooks, settings, secrets, users, teams or IPs → 403;
- JSON bodies up to 64 KiB, one attempt, Bitnob's answer passed through unchanged (504 after 20 s, 502 if unreachable);
- one log line per call, never the body, headers or token.

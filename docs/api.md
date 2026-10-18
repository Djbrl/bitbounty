# Web ↔ server API (I1)

The web pages were built on `fixtures/*.json` (F4). The server now serves the same shapes (`fixtures/types.ts`) from real data, and the web switches with one variable.

## Switch
| Web env | Pages and `/api/*` read from |
| --- | --- |
| `BITBOUNTY_API_URL` (or `NEXT_PUBLIC_API_URL`) set | the real server |
| neither set | the fixtures (offline dev, tests, a demo without a server) |

- Server pages call the server directly (`apps/web/lib/api.ts`, 8 s timeout).
- Browser calls (`/pay` polling, `/live` SSE, onboarding, backlog) go to the web's `/api/*`, which proxies to the server (`apps/web/lib/api-proxy.ts`, 15 s timeout; the live stream stays open). Path segments are re-encoded, so a crafted id can't leave `/api/`.
- **Per-user routes** (`/api/me`, `/api/dashboard`): the web adds `Authorization: Bearer $INTERNAL_API_TOKEN` and `X-BitBounty-User: <GitHub login>` from the Auth.js session. The server trusts the login only with that token (same value on both sides). Without a valid session, `/api/me` and `/api/dashboard` are 401. Only when no `INTERNAL_API_TOKEN` is configured at all (local demo) does the dashboard show every bounty.
- **Loading and errors**: every page shows a loading skeleton (`app/loading.tsx`), and if the server is down, too slow or answers 5xx, a clear error with a retry button (`app/error.tsx`). Unknown ids still render the 404 page. A 401/403 (session expired, or `INTERNAL_API_TOKEN` not the same on both sides) shows "Session expirée ou accès refusé" with a sign-in button instead; it is recognised by the error digest `BITBOUNTY_AUTH`, which survives production builds (they hide error messages). On `/pay`, a `503 funding_not_configured` says funding is not set up on this server yet; only real network failures say "Could not reach BitBounty".

## Server routes (`apps/server/src/api/`)
| Route | Returns (type in `fixtures/types.ts`) | Data |
| --- | --- | --- |
| `GET /api/board` | `Board` | public bounties (not unfunded/cancelled/refunded), paid stats |
| `GET /api/bounties[?status=]` | `BountySummary[]` | every bounty, newest first, claimant and PR number |
| `GET /api/bounties/:id` | `BountyDetail` | fundings, active claim, submission, payout, timeline |
| `GET /api/dashboard` | `Dashboard & { bounties }` | the signed-in maintainer's bounties, needs-action list |
| `GET /api/maintain` | `MaintainHome` (`apps/server/src/api/maintain.ts`) | U4: money summary, review queue (Claude's per-criterion verdict, CI, developer), repos (funded, installed, or agent-posted), payouts with the public reason only, the user's agents and budgets |
| `POST /api/maintain/bounties/:id/pay`, `/hold {note?}` | `{bountyId, status}` | U4: needs a session (401 otherwise, even with auth off). Runs `runMaintainerDecision`, the `/pay` / `/hold` comment path (GitHub permission check, issue lock, `transition()`, bus event → settlement). 403 without write access on the repo, 409 when the status doesn't allow it, 503 without the GitHub App |
| `GET /api/users/:login` | `Profile` | paid work (payouts) and active claims; 404 when none |
| `GET /api/receipts/:id` | `Receipt` | a succeeded payout (`id` = payout id) with merge and funding; `signature` = SHA-256 of the receipt fields |
| `GET /api/me` | `Me` | needs the session (above) |
| `GET /api/live` | SSE: `snapshot` `{columns, cards, route}` then `transition` events | live columns; every internal event as it happens. I4: `route` is the Lagos route of the newest naira-funded bounty on the board (null if none); a transition of a naira-funded bounty carries its `route` too, with the legs known so far |
| `GET /api/live?format=json` | the same snapshot as JSON | the `/live` page's first paint (server render) |
| `POST /api/bounties/:id/funding {rail}` | `FundingSession` | Lightning invoice through B1 (`503` without Bitnob keys, `501` for usdt/ngn) |
| `GET /api/bounties/:id/funding` | `{status: pending\|paid, bountyStatus}` | |
| `POST /api/backlog/fund`, `POST /api/me/payout-account` | `501` with a hint | not wired yet |

Where the data comes from:
- bounties and claims: `bountyRepo` (Postgres with `DATABASE_URL`);
- fundings: B1's store (memory) plus the `fundings` table;
- payouts: the `payouts` table (B2's service isn't wired into `app.ts` yet);
- timelines and the live feed: `ActivityLog`, which records every internal event. It's in memory: after a restart a bounty's timeline starts with its creation date.

## Lagos route on `/live` (I4)
`apps/server/src/api/live-route.ts` builds it from stored records only (no rate is re-fetched, so the numbers match the funding and payout rows):

| Field | Source |
| --- | --- |
| `ngn` | the paid NGN funding's `sourceAmount / 100` (kobo → ₦). B4 asked for `max(₦500, ceil((xof + fee + buffer) × NGN/USDT ÷ XOF/USDT))` with Bitnob's rates at funding time |
| `feeXof`, `bufferXof` | the funding row: `ceil(5% × xof)`, `ceil(3% × xof)`; null when the row has no breakdown (Postgres rows read by `DrizzleFundingReader`) |
| `satsBought` | the NGN→BTC order's receive quantity × 1e8 (`NgnAccount.btcReceived`, needs the `ngnAccounts` dep), for the bounty's share: `floor(orderSats × sourceAmount ÷ claimedKobo)`, since B4 sells everything received and credits the over-deposit back. Null when unknown |
| `xof` | the bounty amount (what the developer receives) |
| `sats`, `xofPerBtc` | the Lightning payout row (B6): `sats = floor(xof × 1e8 ÷ xofPerBtc)`; null before the payout exists or when it failed |

`routeChecks(route)` redoes the sums (fee and buffer, the payout formula, sats bought ≥ sats paid); the e2e script prints them and fails a naira run when one is off. Example (offline fakes, 10 000 F bounty): ₦27 000 paid for 10 800 F = 10 000 + 500 fee + 300 buffer → 18 000 sats bought → paid 16 666 sats at 60 000 000 F/BTC, 1 334 sats (≈ 800 F) kept as fee + buffer. `app.ts` doesn't build B4's `NgnFunding` yet, so on the real server `satsBought` stays null until it does (pass its account store as `ngnAccounts`).

## Known gaps (follow-ups)
- `/me` onboarding (payout account, SMS, test payout) needs B3's routes wired into the server; the page shows the account as not linked.
- "Price my backlog" suggestions (A3) aren't fed into `/api/dashboard` yet (`backlog: []` hides the funding bar).
- Performance: lists make 2 small queries per bounty (claimant, PR) and are capped at 500 bounties; fine for the demo, batch queries later.
- Payouts and receipts show the developer's Lightning Address masked (`aw***@blink.sv`) and the sats sent (B6); legacy mobile money rows show no address.
- With the loading skeleton streaming first, a not-found page answers HTTP 200 (Next.js behaviour); it still shows the 404 content.

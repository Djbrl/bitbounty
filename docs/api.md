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
| `GET /api/users/:login` | `Profile` | paid work (payouts) and active claims; 404 when none |
| `GET /api/receipts/:id` | `Receipt` | a succeeded payout (`id` = payout id) with merge and funding; `signature` = SHA-256 of the receipt fields |
| `GET /api/me` | `Me` | needs the session (above) |
| `GET /api/live` | SSE: `snapshot` then `transition` events | live columns; every internal event as it happens |
| `POST /api/bounties/:id/funding {rail}` | `FundingSession` | Lightning invoice through B1 (`503` without Bitnob keys, `501` for usdt/ngn) |
| `GET /api/bounties/:id/funding` | `{status: pending\|paid, bountyStatus}` | |
| `POST /api/backlog/fund`, `POST /api/me/payout-account` | `501` with a hint | not wired yet |

Where the data comes from:
- bounties and claims: `bountyRepo` (Postgres with `DATABASE_URL`);
- fundings: B1's store (memory) plus the `fundings` table;
- payouts: the `payouts` table (B2's service isn't wired into `app.ts` yet);
- timelines and the live feed: `ActivityLog`, which records every internal event. It's in memory: after a restart a bounty's timeline starts with its creation date.

## Known gaps (follow-ups)
- `/me` onboarding (payout account, SMS, test payout) needs B3's routes wired into the server; the page shows the account as not linked.
- "Price my backlog" suggestions (A3) aren't fed into `/api/dashboard` yet (`backlog: []` hides the funding bar).
- Performance: lists make 2 small queries per bounty (claimant, PR) and are capped at 500 bounties; fine for the demo, batch queries later.
- Payouts and receipts show the developer's Lightning Address masked (`aw***@blink.sv`) and the sats sent (B6); legacy mobile money rows show no address.
- With the loading skeleton streaming first, a not-found page answers HTTP 200 (Next.js behaviour); it still shows the 404 content.

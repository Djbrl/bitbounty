# Web ↔ server API

The server serves the shapes in `fixtures/types.ts` from real data. The web reads either the server or the fixtures, switched by one variable.

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
| `GET /api/maintain` | `MaintainHome` (`apps/server/src/api/maintain.ts`) | money summary, review queue (Claude's per-criterion verdict, CI, developer), repos (funded, installed, or agent-posted), payouts with the public reason only, the user's agents and budgets |
| `POST /api/maintain/bounties/:id/pay`, `/hold {note?}` | `{bountyId, status}` | needs a session (401 otherwise, even with auth off). Runs `runMaintainerDecision`, the `/pay` / `/hold` comment path (GitHub permission check, issue lock, `transition()`, bus event → settlement). 403 without write access on the repo, 409 when the status doesn't allow it, 503 without the GitHub App |
| `GET /api/users/:login` | `Profile` | paid work (payouts) and active claims; 404 when none |
| `GET /api/receipts/:id` | `Receipt` | a succeeded payout (`id` = payout id) with merge and funding; `signature` = SHA-256 of the receipt fields |
| `GET /api/me` | `Me` | needs the session (above) |
| `GET /api/live` | SSE: `snapshot` then `transition` events | live columns; every internal event as it happens |
| `POST /api/bounties/:id/funding {rail}` | `FundingSession` | Lightning invoice (`503` without Bitnob keys, `501` for `usdt` / `ngn`: not wired) |
| `POST /api/bounties/:id/funding/simulate` | `FundingSession` | sandbox keys only: settles the open invoice with Bitnob's `simulate-payment` |
| `GET /api/bounties/:id/funding` | `{status: pending\|paid, bountyStatus}` | |
| `GET`/`POST /api/me/mode` | workspace (hunt / maintain) | |
| `GET`/`POST /api/me/onboarding`, `POST /api/me/lightning-address` | see [onboarding](../apps/server/src/onboarding/README.md) | |
| `POST /api/backlog/suggest` | `BacklogResult` | "Price my backlog" ([backlog.md](backlog.md)) |
| `POST /api/backlog/fund`, `POST /api/me/payout-account` | `501` with a hint | not wired |

Where the data comes from:
- bounties and claims: `bountyRepo` (Postgres with `DATABASE_URL`);
- fundings: the Lightning funding store (in memory) plus the `fundings` table;
- payouts: the `payouts` table;
- timelines and the live feed: `ActivityLog`, which records every internal event in memory, so after a restart a bounty's timeline starts at its creation date.

## Known gaps
- Funding several backlog suggestions in one payment (`POST /api/backlog/fund`) isn't wired; bounties are funded one by one.
- Lists make 2 small queries per bounty and are capped at 500 bounties.
- With the loading skeleton streaming first, a not-found page answers HTTP 200 (Next.js behaviour) while showing the 404 content.

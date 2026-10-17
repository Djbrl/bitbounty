# fixtures/ (F4)

Fake but realistic data for every page, served by a mock `/api/*` route in `apps/web`, so the W tasks never wait for the back end. I1 swaps the mock for the real API; pages only depend on the URLs and shapes below.

Shapes and names follow the F2 contract (`@bitbounty/core`, PR #44): camelCase fields, core statuses, events and `TRANSITIONS`. Rules: money is always an **integer** in the smallest unit (FCFA, sats, USDT base units where 1 USDT = 1 000 000, NGN kobo). Phone numbers are always masked (`+221 77 ••• •• 42`). Timestamps are UTC (= Dakar time), 17–18 Oct 2026.

## Which file feeds which page

| Page | Endpoint (mock) | File |
|---|---|---|
| `/` public board | `GET /api/board` | `board.json` (stats, funded bounties, external "paid in dollars elsewhere" rows) |
| any list | `GET /api/bounties?status=a,b&repo=&funder=` | `bounties.json` → summaries (no timeline) |
| `/dashboard` | `GET /api/dashboard` | `dashboard.json` (+ the bounties listed in `bountyIds`, joined) |
| `/dashboard` "Fund N bounties" | `POST /api/backlog/fund {ids?, rail?}` | `dashboard.json` `backlog` + `funding.json`; returns `bountyIds` (`sug-1` → `b-sug-1`, an unfunded bounty `/pay/[id]` and `/api/bounties/:id` resolve) |
| `/b/[id]` | `GET /api/bounties/:id` | `bounties.json` (full detail: fundings, claims, submission + Claude report, payout, timeline) |
| `/pay/[id]` | `POST /api/bounties/:id/funding {rail}` | `funding.json` (one template per rail, rescaled to the bounty, `expiresAt` = now + 15 min) |
| `/pay/[id]` polling | `GET /api/bounties/:id/funding` | `pending` twice, then `paid` on the 3rd poll (unfunded bounties only) |
| `/me` | `GET /api/me?state=new\|pending\|sms_ok\|verified` (default `verified`) | `me.json` |
| `/me` steps | `POST /api/me/payout-account` → `/sms {code}` → `/confirm {amount}` | `me.json` `mock`: SMS code `424242`, test amount `137` FCFA |
| `/u/[login]` | `GET /api/users/:login` | `users.json` (awa-ndiaye, fatou-sall, moussa-diop, seynabou-gueye) |
| `/r/[id]` | `GET /api/receipts/:id` | `receipts.json` (`r-107`, `r-113`) |
| `/live` | `GET /api/live` (SSE: `snapshot`, then `transition` events, loops; `?speed=4` to fast-forward) · `GET /api/live?format=json` | `live.json` |

Unknown ids return `404 {error}`; bad input returns `400`/`409`/`422 {error}`.

## One bounty per state (`bounties.json`)

| id | status | what it shows |
|---|---|---|
| b-101 | `unfunded` | criteria drafted by Claude, not confirmed (`/criteria ok` pending) |
| b-102 | `funded` | Lightning-funded; one claim released (`/unclaim`), then PR #4 (verdict fail) `/reject`ed → open again |
| b-103 | `claimed` | active claim by @awa-ndiaye, 72 h timer |
| b-104 | `submitted` | PR #31, Claude verdict **fail** (2/3 criteria), USDT-funded |
| b-105 | `verified` | merged, verdict **pass**, 24 h objection window running |
| b-106 | `paying` | Wolof translation, payout `processing` on Wave |
| b-107 | `paid` | **headline happy path**: 10 000 FCFA to @awa-ndiaye on Wave, 6 min after merge, receipt `r-107` |
| b-108 | `payout_failed` | verdict **unsure** → merge puts it `on_hold` → maintainer `/pay`; Orange Money, 3 attempts (`payout.started`/`payout.failed` ×3), `withdrawal.expired`, money stays reserved |
| b-109 | `on_hold` | verdict **unsure**, maintainer `/hold` before merging (`maintainer.hold`) |
| b-110 | `refunded` | closed "not planned" before any claim (`bounty.cancelled` from `funded`) |
| b-111 | `cancelled` | `/cancel` before funding |
| b-112 | `funded` | **claim expired** (5-min demo timer), open again |
| b-113 | `paid` | **Lagos route**: ₦29 000 bank transfer (NGN → BTC) → 10 000 FCFA on Wave, receipt `r-113` |
| b-114 | `claimed` | **agent-funded** (Claude Code via MCP), Wolof SMS task |

Every timeline uses only F2's 15 `EVENT_TYPES` and is a legal path through F2's `TRANSITIONS` (each entry carries the `to` status it led to); every event type appears at least once. `bounties.json` entities are the core types (`Bounty`, `Funding`, `Claim`, `Submission`, `Payout`, `User`) plus a few view-only fields (`issueUrl`, `criteriaConfirmed`, `funderLogin`, `labels`, `updatedAt`, `userLogin`, `prUrl`, `ci`, `phoneMasked`…). `/api/me` returns `PayoutAccount` without `phoneE164`/`testAmountXof` (never sent to the browser) and with `phoneMasked`.

## Files

- `types.ts`: **temporary mirror** of `packages/core` (#44): statuses, events, `TRANSITIONS`, entity types, copied verbatim. Replace with import from `@bitbounty/core` once #44 merges (the view / page DTOs at the bottom stay or move to core).
- `generate.mjs`: writes all JSON. Edit it, then `node fixtures/generate.mjs`.
- `check.mjs`: validates every file against `types.ts` (enums, integer money, dates, cross-file ids), **replays every timeline through `TRANSITIONS`** (incl. the `pr.merged` → verified/on_hold rule), and checks state invariants (e.g. `paid` ⇒ succeeded payout, `claimed` ⇒ exactly one active claim, `funded` ⇒ no active claim), plus coverage of every state, claim status, verdict, rail and `/me` step. Exits 1 on failure.
- `fixtures.test.ts`: runs `check.mjs` and exercises every mock endpoint (`apps/web/lib/mock-api.ts`), including the SSE stream.

```sh
node fixtures/check.mjs
node --test fixtures/fixtures.test.ts   # Node >= 22.18 (type stripping)
```

## Mock route

- `apps/web/app/api/[...path]/route.ts`: thin Next.js handler (GET + POST), imports the JSON.
- `apps/web/lib/mock-api.ts`: the pure request → response logic (testable without Next).
- More specific routes (e.g. `/api/auth/[...nextauth]` from W9) take precedence over the catch-all.

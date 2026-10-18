# BitBounty: implementation plan

v1, 16 10 2026, the plan written before the event. Since then, developers are paid **in sats over Lightning to a Lightning Address** (mobile money payouts were dropped on Sat 17 Oct, see [architecture.md](architecture.md)), and the server runs with Docker rather than on Railway ([setup.md](setup.md)). Product: [product.md](product.md). Visual mockups: https://claude.ai/artifact/AdaU49nNMoDQN81tvqcXQc (ask Jib for access).
**Nothing here gets coded before 17 10, 15:00.** Before that: generic boilerplate only (repo, scaffolds, deploy), allowed by the organisers.

## 1. Scope
**P0 (the demo depends on it):** maintainer dashboard + "Price my backlog" (Claude) · GitHub App (commands + status comment) · Lightning funding (Bitnob sandbox) · claim · PR detection · Claude verifier (GitHub check) · merge → payout in sats over Lightning (sandbox) · developer onboarding (GitHub login + payout account + test payment) · payment page · bounty page · live demo screen.
**P1 (makes the difference):** NGN funding (virtual account + simulate-deposit + NGN→BTC trade) · client agent (MCP server + Claude Code demo) · proof-of-work profile · public board.
**P2 (if there's time):** USDT funding · Nemotron/Claude scout that proposes bounties · measured checker (bench) · refunds/cancellations beyond the basic case.

## 2. Stack
| Layer | Choice | Why |
|---|---|---|
| Monorepo | pnpm workspaces, TypeScript everywhere | one language, types shared between front and back |
| Web | Next.js 15 (App Router) + Tailwind + shadcn/ui | fast to build, GitHub OAuth via Auth.js |
| Server | Node 22 + Hono, `@octokit/app` + `@octokit/webhooks` | GitHub App webhooks, Bitnob webhooks, agent API |
| Jobs | pg-boss (queue in Postgres) in the server process | invoice polling, payouts, timers, retries; no Redis |
| DB | Postgres (Neon or Supabase) + Drizzle ORM | ledger + state machine, migrations in code |
| Bitnob | `packages/bitnob`: our typed client (HMAC) | **becomes the open-source SDK** (dogfooding) |
| AI | Anthropic SDK, `claude-sonnet-5` (verifier, criteria), `claude-opus-5-5` if quality is lacking | Jib's key; Nemotron not needed |
| Agent | `packages/mcp`: MCP server (post_bounty, get_bounty, cancel_bounty) | Claude Code demo |
| Hosting | Docker Compose (server + Postgres + smee + Cloudflare tunnel) · Vercel (web) | free, fast deploy |
| Webhook dev | smee.io (GitHub) · ngrok (Bitnob) | local dev |

```
apps/web        Next.js: pages /, /dashboard (maintainer), /b/[id], /pay/[id], /me, /u/[login], /live
apps/server     Hono: /webhooks/github, /webhooks/bitnob, /api/*, /v1/* (agents), jobs
packages/bitnob Bitnob client (HMAC, typed endpoints)
packages/core   shared types, state machine, commands parser, money utils
packages/mcp    MCP server for agents
packages/db     Drizzle schema + migrations
```

## 3. Contract (written first, Saturday 15:00, like Brainstorm's types.ts)
`packages/core/src/types.ts`: everyone codes against it; it can only grow.

### State machine (bounty)
`unfunded → funded → claimed → submitted → verified → paying → paid`
Side states: `refunded`, `cancelled`, `on_hold`, `payout_failed` (retry).
Allowed transitions in `packages/core/src/machine.ts`; **only `transition()` writes the status** and records an event. AI never changes a status.
Details, the full transition table and the event list: [packages/core/README.md](../packages/core/README.md).

### Tables (Drizzle)
- `users` (id, github_id, login, avatar_url, created_at)
- `payout_accounts` (user_id, lightning_address (B6), status `pending|sms_ok|verified`, verified_at, locked_until; the mobile money columns of the first draft become optional)
- `installations` (github_installation_id, account_login), `repos` (installation_id, full_name, settings jsonb)
- `bounties` (id, repo_id, issue_number, issue_title, amount_xof, status, criteria jsonb, funder_kind `human|agent`, funder_id, status_comment_id, created_at, expires_at)
- `fundings` (bounty_id, rail `lightning|usdt|ngn`, source_amount, source_currency, bitnob_ref, payment_hash, status, paid_at)
- `claims` (bounty_id, user_id, status `active|released|expired|done`, expires_at)
- `submissions` (bounty_id, pr_number, author_login, head_sha, verdict `pass|fail|unsure`, report jsonb, spam_score, merged_at)
- `payouts` (bounty_id, user_id, amount_xof, quote_id, bitnob_payout_id, reference, status, attempts, last_error, paid_at)
- `ledger` (id, bounty_id, kind `fund|fee|reserve|payout|refund|fx`, amount, currency, ref)
- `events` (id serial, bounty_id nullable, source `github|bitnob|system`, external_id, type, action, repo, installation_id, payload, status `received|processed|failed`, error, received_at, processed_at; UNIQUE (source, external_id)): audit log + webhook dedupe + bounty timeline
- `agents` (owner_user_id, key_hash, monthly_budget_xof, per_task_max_xof, allowed_repos)

### GitHub commands (issue/PR comments)
`/bounty <amount>` · `/criteria ok` · `/claim` · `/unclaim` · `/extend` · `/pay [@user] [now]` · `/hold` · `/reject <reason>` · `/cancel`
Permissions: `/bounty /criteria /pay /hold /reject /cancel` = write access on the repo. `/claim /unclaim /extend` = any user with a linked account.

### Webhooks received
- GitHub: `installation`, `issue_comment.created`, `issues.closed|reopened`, `pull_request.opened|synchronize|closed`
- Bitnob: `payouts.initialized|processing|withdrawal.success|withdrawal.expired`, `virtual_account.deposit.success`, `deposit.success` (USDT). **Lightning: no webhook → job polling `GET /api/lightning/invoices/:id` every 3 s while the payment page is open, every 30 s otherwise.**

### HTTP API
- `GET /api/bounties?status=` · `GET /api/bounties/:id` (timeline included)
- `POST /api/bounties/:id/funding` `{rail}` → `{invoice|address|virtual_account, amount, expires_at}`
- `GET /api/me` · `POST /api/me/payout-account` · `POST /api/me/payout-account/sms` `{code}` (code OK → status `sms_ok` and the server sends the 100–199 F test, B3; returns `Me` + `testPayoutSent`) · `POST /api/me/payout-account/confirm` `{amount}` → `Me` | 422 `{error:"wrong_amount", attemptsLeft}` | 423 `{error:"locked", lockedUntil}` after 3 wrong amounts
- `GET /api/users/:login` (proof-of-work profile) · `GET /api/live` (SSE stream for /live)
- Agents: `POST /v1/bounties` `{repo, issue|title+body, amount_xof, criteria}` · `GET /v1/bounties/:id` (header `Authorization: Bearer bb_...`)

## 4. Bitnob flows (exact calls)
Funding over Lightning: `POST /api/lightning/invoices {amount (sats), description:"BitBounty #id", reference:"fund-<bountyId>-<n>", expiry:900}` → polling → `status=paid` → `transition(funded)` → ledger `fund`, `fee`, `reserve`.
Sats are converted to USDT if we hold in USDT: `POST /api/trading/quotes {base_currency:"BTC", quote_currency:"USDT", side:"sell", quantity}` → `POST /api/trading/orders {quote_id}` (P1; in P0 we can stay in BTC and pay out from BTC).
NGN funding (P1): `customers` (identity) → `POST /api/virtual-accounts` → (sandbox) `POST /api/virtual-accounts/:id/simulate-deposit` ×N (₦1,000/call) → webhook `virtual_account.deposit.success` → NGN/BTC trade (`quote_id` required, quote valid 30 s in sandbox) → funded.
Payout (B6, [#102](https://github.com/Djbrl/bitbounty/pull/102), replaces the first mobile money plan): FCFA → sats at Bitnob's rate (`GET /api/exchange-rates` + `GET /api/trading/prices`) → LNURL-pay on the developer's Lightning Address for that exact amount, invoice checked (amount, network, expiry) → `POST /api/lightning/pay {request, reference:"pay-<bountyId>-<n>", max_fee}`, sent once per attempt → status polled until paid.
Test payment (onboarding): planned as a small mobile money payout the developer confirms; dropped with that rail.

## 5. Claude verifier
Input: title + body + criteria of the issue, PR diff (cap ~60k tokens, priority to non-test files, then tests), CI status, list of files.
Output (JSON schema, enforced):
```json
{"criteria":[{"text":"…","met":true,"evidence":"file:line or explanation"}],
 "verdict":"pass|fail|unsure","summary":"2 sentences","risk_flags":["touches unrelated files"]}
```
Published as a **GitHub Check Run** "BitBounty verification" (success / failure / neutral) on the PR's head_sha. Rule: automatic payment only if `verdict=pass` AND CI green AND merge. Otherwise the maintainer `/pay` or `/reject`.
Criteria drafted when missing: same call with a "draft 2–4 testable criteria" prompt → the bot proposes them → `/criteria ok`.

## 6. Team split (2 people + their Claude Code agents)
**Partner = back end ("rails")**: monorepo/DB/deploy, Bitnob client, GitHub App + commands, state machine, jobs, payouts, Bitnob webhooks, NGN rail.
**Jib = product ("surfaces")**: web (all pages), bot comment copy, verifier (prompt + Check Run), MCP agent + Claude Code demo, /live screen, pitch, demo script.
Each runs 2–3 parallel agents on separate folders (Brainstorm rule: one folder per agent, the contract first, small commits prefixed with the agent's name).

## 7. Timeline (Sat 15:00 → Sun 14:00)
| Slot | Partner (back end) | Jib (product) | Done when |
|---|---|---|---|
| Sat 11:00–15:00 | Bitnob account, sandbox keys, `whoami` | the same + notes from the workshop (SN payouts? webhooks?) | keys working |
| 15:00–16:00 | contract `types.ts` + `machine.ts` together | together | contract committed |
| 16:00–18:00 | Bitnob client + test of the 4 key calls (invoice, payout quote SN, VA simulate, NGN quote) · GitHub App registered, webhooks received | web skeleton + design tokens + /b/[id] and /pay/[id] on mock data | 4 calls OK + webhook visible |
| 18:00–21:00 | `/bounty` → DB → status comment · Lightning funding → polling → "Funded" | /me onboarding (GitHub OAuth, number, SMS mock, test payment) · real /pay | a funded issue end to end |
| 21:00–00:00 | `/claim` + timer · PR detection · merge → payout → receipt comment | Claude verifier + Check Run · bot copy | **full P0 loop** in sandbox |
| 00:00–04:00 | NGN rail (P1) · retries/idempotency | MCP server + Claude Code demo (P1) · /live screen | P1 demoable |
| 04:00–08:00 | sleep in shifts (one person awake = tests) | | |
| 08:00–11:00 | stabilisation, seed demo repo | /u/[login] profile, public board, polish | 3 clean runs |
| 11:00–13:00 | README, setup, LICENSE, `bitnob` package published | pitch + 3 rehearsals + backup video | rehearsed |
| **13:00** | **code freeze** | | |
| 13:00–14:00 | submission form, links checked in private browsing | | submitted |

## 8. Demo (3 min)
1. (20 s) Maintainer problem: 40 open issues, no contributors, and paying someone in Dakar/Lagos = invoices + transfers + compliance. Then: "Price my backlog" → Claude proposes 5 bounties → one payment funds them.
2. (40 s) Maintainer: `/bounty 10000` on an issue of the demo repo → pays over Lightning → the comment switches to "Funded".
3. (30 s) Developer (on a phone): `/claim` → PR → Claude's check appears in the PR (criteria ✅).
4. (30 s) Merge → **the developer's phone gets the payment** → receipt comment, /live screen.
5. (30 s) Agent: Claude Code, in the same repo, funds a Wolof translation itself through MCP → a teammate delivers → paid.
6. (20 s) Lagos: a bank transfer in naira funds a bounty → paid in FCFA in Dakar. Bitcoin as the bridge.
7. (10 s) Close: proof-of-work profile + the Btrust line: "locating, educating, remunerating: BitBounty turns it into a GitHub button" (see docs/product.md).
Backup: a video of the full loop recorded Sunday morning.

## 9. Risks → fallbacks
| Risk | Fallback |
|---|---|
| Bitnob sandbox can't pay out | show every step up to the pay call, say so on stage (it happened: mobile money payouts were dropped, and Lightning withdrawals are not enabled on our sandbox account) |
| Bitnob webhooks not firing in sandbox | polling `GET /api/payouts/:id` |
| Lightning: on-the-fly invoice impossible | wallet-funded model (our sandbox balance) |
| GitHub App webhook flaky on venue Wi-Fi | phone hotspot + server online from day 1 (Docker + smee + Cloudflare tunnel) |
| Verifier slow | Sonnet, capped diff, verdict precomputed on synchronize |
| Live demo crashes | backup video + "replay" mode on /live |

## 10. Allowed prep before the event (generic boilerplate)
Empty monorepo + scaffolds (Next.js/Tailwind/shadcn, Hono, Drizzle connected to an empty DB), Docker/Vercel deploy pipeline, `.env.example`. **No product logic** (no commands, no state machine, no Bitnob calls).

# BitBounty: implementation plan

The plan written on 16 Oct 2026, before the hackathon. Code comments refer to its sections (§2 stack, §3 contract, §5 verifier). Where the build differs:
- developers are paid **in sats over Lightning** to a Lightning Address; the first plan's mobile money payouts and SMS test payment were dropped;
- no pg-boss: events and timers run in the server process; Postgres runs in Docker, not on Neon or Supabase;
- no Nemotron: Claude does the verifier and the pricing;
- `/criteria ok` and drafted criteria were not built: the verifier reads the issue's "Done when" list;
- naira funding works in the sandbox but is not wired on the server; USDT funding and sats → USDT conversion were not built.

What was built: [README](../README.md), [architecture.md](architecture.md).

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

## 3. Contract
`packages/core/src/types.ts`: everyone codes against it; it can only grow.

### State machine (bounty)
`unfunded → funded → claimed → submitted → verified → paying → paid`
Side states: `refunded`, `cancelled`, `on_hold`, `payout_failed` (retry).
Allowed transitions in `packages/core/src/machine.ts`; **only `transition()` writes the status** and records an event. AI never changes a status.
Details, the full transition table and the event list: [packages/core/README.md](../packages/core/README.md).

### Tables (Drizzle)
- `users` (id, github_id, login, avatar_url, created_at)
- `payout_accounts` (user_id, lightning_address, status, verified_at, locked_until; the first draft's mobile money columns are optional)
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
`/bounty <amount>` · `/criteria ok` · `/claim` · `/unclaim` · `/extend` · `/pay [@user] [now]` · `/hold` · `/reject <reason>` · `/cancel` · `/funded` (Bitnob sandbox demo only: simulates the funding payment)
Permissions: `/bounty /criteria /pay /hold /reject /cancel /funded` = write access on the repo. `/claim /unclaim /extend` = any user with a linked account.

### Webhooks received
- GitHub: `installation`, `issue_comment.created`, `issues.closed|reopened`, `pull_request.opened|synchronize|closed`
- Bitnob: `payouts.initialized|processing|withdrawal.success|withdrawal.expired`, `virtual_account.deposit.success`, `deposit.success` (USDT). **Lightning: no webhook → job polling `GET /api/lightning/invoices/:id` every 3 s while the payment page is open, every 30 s otherwise.**

### HTTP API
- `GET /api/bounties?status=` · `GET /api/bounties/:id` (timeline included)
- `POST /api/bounties/:id/funding` `{rail}` → `{invoice|address|virtual_account, amount, expires_at}`
- `GET /api/me` · `POST /api/me/lightning-address` `{lightningAddress}` (built later; the planned SMS + test payment flow was dropped)
- `GET /api/users/:login` (proof-of-work profile) · `GET /api/live` (SSE stream for /live)
- Agents: `POST /v1/bounties` `{repo, issue|title+body, amount_xof, criteria}` · `GET /v1/bounties/:id` (header `Authorization: Bearer bb_...`)

## 4. Bitnob flows (exact calls)
Funding over Lightning: `POST /api/lightning/invoices {amount (sats), description:"BitBounty #id", reference:"fund-<bountyId>-<n>", expiry:900}` → polling → `status=paid` → `transition(funded)` → ledger `fund`, `fee`, `reserve`.
NGN funding (P1): `customers` (identity) → `POST /api/virtual-accounts` → (sandbox) `POST /api/virtual-accounts/:id/simulate-deposit` ×N (₦1,000/call) → webhook `virtual_account.deposit.success` → NGN/BTC trade (`quote_id` required, quote valid 30 s in sandbox) → funded.
Payout: FCFA → sats at Bitnob's rate (`GET /api/exchange-rates` + `GET /api/trading/prices`) → LNURL-pay on the developer's Lightning Address for that exact amount, invoice checked (amount, network, expiry) → `POST /api/lightning/pay {request, reference:"pay-<bountyId>-<n>", max_fee}`, sent once per attempt → status polled until paid.

## 5. Claude verifier
Input: title + body + criteria of the issue, PR diff (cap ~60k tokens, priority to non-test files, then tests), CI status, list of files.
Output (JSON schema, enforced):
```json
{"criteria":[{"text":"…","met":true,"evidence":"file:line or explanation"}],
 "verdict":"pass|fail|unsure","summary":"2 sentences","risk_flags":["touches unrelated files"]}
```
Published as a **GitHub Check Run** "BitBounty verification" (success / failure / neutral) on the PR's head_sha. Rule: automatic payment only if `verdict=pass` AND CI green AND merge. Otherwise the maintainer `/pay` or `/reject`.
Criteria drafted when missing: same call with a "draft 2–4 testable criteria" prompt → the bot proposes them → `/criteria ok`.

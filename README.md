# BitBounty

**Bounties on GitHub issues, priced in FCFA, funded through Bitnob, paid in sats over Lightning.**

Built at Code & Chain Dakar 2026 (a Bitnob hackathon, 17–18 Oct 2026). All the code was written by AI agents. MIT licence. The team's hackathon agreement is at the end of this file: [Hackathon team rules](#hackathon-team-rules).

| | |
| --- | --- |
| Web app | https://bitbounty-app.vercel.app |
| Demo repo | https://github.com/Djbrl/bitbounty-demo |
| GitHub App | https://github.com/apps/bitbounty-dakar |
| Pitch deck | [docs/pitch/BitBounty_v6.pptx](docs/pitch/BitBounty_v6.pptx) |

## What it does
1. A maintainer comments `/bounty 10000` on an issue of a repo where the GitHub App is installed. The amount is in FCFA, what the developer receives.
2. They fund it through Bitnob by paying a Lightning invoice in sats. The bot's status comment switches to **Funded**.
3. A developer comments `/claim`. One active claim per issue, with a timer (`/extend` once, `/unclaim` to release it).
4. The developer opens a PR that says `Fixes #12`.
5. Claude checks the PR against the issue's "Done when" criteria and posts the result as a GitHub check. It only advises; it never moves money.
6. The maintainer merges. The merge is the approval (`/hold` stops the payout, `/pay` forces one).
7. The developer is paid in sats over Lightning to their Lightning Address: FCFA converted to sats at Bitnob's rate, an invoice for that exact amount requested from their wallet (LNURL-pay), and paid through Bitnob.

Also built: "Price my backlog" (Claude suggests which open issues to fund, with criteria and a price), a public board, proof-of-work profiles and receipts, and an API plus MCP server so an AI agent can post bounties within a budget its human owner sets ([docs/agents.md](docs/agents.md)).

## Status
- **Lightning funding** works against the Bitnob sandbox (invoice created, payment simulated, bounty moves to `funded`).
- **Lightning payouts** are implemented: one pay call per attempt with an idempotent reference, a sats cap per payout (`MAX_PAYOUT_SATS`), payouts stored in Postgres and resumed after a restart. They default to testnet. No payout has completed end to end yet: the sandbox refuses the pay call (`403 FEATURE_NOT_ENABLED`, `send_lightning`) and our production key is rejected with `401 Invalid HMAC` ([#86](https://github.com/Djbrl/bitbounty/issues/86)).
- **Naira funding** (NGN virtual account, then an NGN→BTC trade) is proven in the Bitnob sandbox only. It is not wired on the live server ([#168](https://github.com/Djbrl/bitbounty/issues/168)); the payment page offers Lightning only.
- **Cancelling** a funded bounty marks it `refunded`, but no refund transfer is implemented: returning the money is manual.

## Bitnob APIs used
All calls go through our typed client, [`packages/bitnob`](packages/bitnob). Details and sandbox results: [docs/bitnob-api.md](docs/bitnob-api.md).

| What | Endpoints |
| --- | --- |
| HMAC auth | `x-auth-client`, `x-auth-timestamp`, `x-auth-nonce`, `x-auth-signature` (HMAC-SHA256), re-signed on each retry; `GET /api/whoami` |
| Customers | `POST /api/customers` (needed for invoices and virtual accounts) |
| Lightning funding | `POST /api/lightning/invoices`, `GET /api/lightning/invoices/:id` polled (no Lightning webhook); sandbox `simulate-payment` |
| Rates | `GET /api/exchange-rates` (USDT ↔ FCFA / NGN), `GET /api/trading/prices` (BTC ↔ USDT) |
| Lightning payouts | `POST /api/lightning/pay` with an idempotent `reference`; `POST /api/lightning/decode` to cross-check our invoice decoding |
| Naira funding (sandbox only) | `POST /api/virtual-accounts`, `simulate-deposit`, `POST /api/trading/quotes` + `/orders` (NGN → BTC) |
| Webhooks | `POST /webhooks/bitnob`, `x-bitnob-signature` (HMAC-SHA512 of the raw body), stored once per `event_id` |

## Architecture
- pnpm monorepo, TypeScript, Node 22.
- [`apps/server`](apps/server): Hono server. GitHub App webhooks and commands, funding, settlement after the merge, payouts, the web API (`/api`) and the agent API (`/v1`).
- [`apps/web`](apps/web): Next.js 15, Tailwind 4, sign in with GitHub (Auth.js). Runs on Vercel.
- [`packages/core`](packages/core): the bounty state machine, events, types and money helpers. Only `transition()` changes a bounty's status.
- [`packages/db`](packages/db): Postgres 16 schema, migrations and demo seed (Drizzle).
- [`packages/bitnob`](packages/bitnob): typed Bitnob client (HMAC signing, retries, typed errors).
- [`packages/mcp`](packages/mcp): MCP server that lets an AI agent post and track bounties.
- Claude (`claude-sonnet-5-5` by default) runs the PR verifier and "Price my backlog". The server, Postgres, a smee relay for GitHub webhooks and a Cloudflare tunnel run with Docker Compose.

Diagram: [docs/architecture.md](docs/architecture.md).

## Run it locally
```sh
corepack enable && pnpm install
cp .env.example .env
docker compose up -d db
pnpm db:migrate && pnpm db:seed
pnpm dev          # web on http://localhost:3000, server on http://localhost:8787
```
Without keys, the web runs on demo data and the server on in-memory stores. GitHub App, Bitnob and Claude keys: [docs/setup.md](docs/setup.md). Checks: `pnpm lint`, `pnpm test`, `pnpm typecheck`.

## Built with AI agents
Every line of code was written by Claude Code (Claude Opus 5.5, `claude-opus-5-5`); no human wrote code. Humans chose and sized the tasks, wrote the briefs, reviewed, tested, merged, and did the pitch and demo. Each PR names the agent and model, and agent commits carry a `Co-Authored-By` trailer.

## Team
[@Djbrl](https://github.com/Djbrl) · [@Rabatou](https://github.com/Rabatou) · [@Kml221-bot](https://github.com/Kml221-bot) · [@cheikhteej](https://github.com/cheikhteej)

## Docs
| | |
| --- | --- |
| [docs/setup.md](docs/setup.md) | Run locally, keys, Docker, deploy the web to Vercel |
| [docs/architecture.md](docs/architecture.md) | Diagram and the role of each part |
| [docs/bitnob-api.md](docs/bitnob-api.md) | Bitnob API notes, quirks and our sandbox results |
| [docs/github-app.md](docs/github-app.md) | The GitHub App: permissions, webhooks, commands, the verification check |
| [docs/api.md](docs/api.md) | Web ↔ server API |
| [docs/auth.md](docs/auth.md) | Sign in with GitHub |
| [docs/agents.md](docs/agents.md) | Agents as funders: `bb_` keys, budgets, `/v1` API, MCP server |
| [docs/backlog.md](docs/backlog.md) | "Price my backlog" |
| [docs/product.md](docs/product.md) | Product definition and design rules |
| [docs/plan.md](docs/plan.md) | The pre-event implementation plan (contract, data model, verifier) |
| [docs/demo/](docs/demo/demo-repo.md) | The demo repo and the agent demo |
| [TASKS.md](TASKS.md) | The hackathon task board |

## License
[MIT](LICENSE), © 2026 BitBounty contributors.

---

# Hackathon team rules

The sections below are the team's internal agreement for the hackathon (AI-only code, how a cash prize is split, the points tally). They are kept here unchanged, as agreed by the team.

## Team agreement

Every member agrees to this section before taking a task. Agree by adding your GitHub handle and the time under "Signed" in a commit or PR.

### AI-only code
1. **All code in this repo is written by AI coding agents** (Claude Code, Codex or similar). Humans don't type code: no hand-written functions, no hand edits to source files, no pasted code from elsewhere.
2. Humans do everything else: choose and size tasks, write prompts and briefs, review, run and test, decide, merge, and do the non-code work (pitch, video, demo, design decisions, talking to Bitnob).
3. **Merge conflicts, fixes and refactors are also done by agents.** If an agent gets something wrong, you ask it to fix it; you don't fix it by hand.
4. The only things a human may type directly are secrets and environment values (`.env`, dashboard settings), never committed.
5. **Every PR says which agent and model wrote it** (for example "Claude Code, claude-opus-5-5"). Agent commits carry the agent's co-author trailer.
6. A PR containing human-written code is not merged. If it's discovered after the merge, the task's points are cancelled and the code is redone by an agent.
7. We tell the judges openly that the code is 100% agent-written, and we list the models used in the submission.

### Prize agreement
The split covers any cash prize the team wins (overall placing or partner award).

1. **20% is split equally** among the 4 members.
2. **80% is split in proportion to the points each member completed**, according to [TASKS.md](TASKS.md).
3. **No freeloaders.** To receive the equal 20% share, a member must have completed **at least 10 points** and been present for the demo. If not, their equal share goes back into the 80% pool.
4. **Points count when a task is done**: PR merged (and its done-when met, see rule 11). Non-code tasks (pitch, video, demo, README, submission) earn points like any other.
5. **One PR per task, tested and documented before it's pushed. A PR that breaks this rule earns no points**, even if it gets merged. In practice:
   - **One task = one PR.** No PR that mixes two tasks, no task split across several PRs (except a follow-up fix explicitly requested in review).
   - **Tested:** code tasks ship with automated tests that pass (`pnpm test`). If something really can't be tested automatically (UI, sandbox calls), the PR gives the manual test steps and proof (screenshot, log, response).
   - **Documented:** the PR description says what changes, why, and how to test it. If the behaviour, a command, an endpoint or a variable changes, the matching doc (`docs/`, README, `.env.example`) is updated in the same PR.
   - Non-code tasks (pitch, video, demo): the PR or issue links the deliverable and says how it was checked.
   - **Adversarial review is encouraged, not required** (amended Sat 17 Oct, 22:15, agreed by all 4: in practice reviews couldn't keep up). Reviews are logged in #77.
6. **Adversarial reviews (optional) are worth +0.5 points each** (with the comment listing what was tried), capped at 5 points per person.
7. **Task points are fixed before 15:30 on Saturday**, agreed by 2 members. A task added later is sized by 2 members before anyone takes it. Points don't change after the task is claimed.
8. **Stale tasks:** a claimed task with no commit or message for 90 minutes goes back to the pool. Its points go to whoever finishes it.
9. **Disputes** about a task are settled by the 2 members not involved in it. Their decision is final.
10. The final points tally is written in this README before 14:00 on Sunday and agreed by all 4 members before any money is shared.
11. **Penalties** (added Sat 17 Oct, agreed by all 4), checked against the state of the PR **when it was pushed**:
    - **Done-when not met** → the task earns **0** for its author, and its points go to a **shared pool** split equally between the 4 members.
    - **A bad break** (a crash, a broken build on main, money or data at risk) that decent testing would have caught → **half** the task's points.
    - Fixes made on top of someone's PR are logged in #77 with who did what. The audit is in the tally below.
12. **Captain** (announced by Djbrl, Sun 18 Oct, 02:00): from now on Djbrl is captain for all operations. The captain sizes new tasks and confirms points instead of 2 members (replaces rule 7 for tasks added after this), and decides how a done-when is proven when the original path is blocked (e.g. B6 proven on production because the sandbox can't send Lightning).

**Formula.** For prize P, with your points p and the team total T:
`your share = 0.20 × P / 4 + 0.80 × P × p / T`.
Example with P = $1,000 and points 30 / 28 / 25 / 17 (T = 100): $290, $274, $250, $186.

### Signed
| Member | GitHub | Agreed at |
| --- | --- | --- |
| Jib | @Djbrl | |
| | | |
| | | |
| | | |

### Points tally (filled in during the event)
Status at Sun 18 Oct, 11:30, with rule 11 applied to every merged PR (per-PR audit: who wrote it, clean or fixed, breaks, done-when at push).

| Member | Earned | Lost to the pool (done-when not met at push) | Halved (bad break) | Reviews | Points |
| --- | --- | --- | --- | --- | --- |
| Djbrl | W1, W3–W8, G1–G3, G5, A1, A2 (30) · F7 (2) · A5 (2) · L1 (3), U1, U2 (2), U3, U4, U5 (12) · F4 ½ (1) · W2 ½ (1.5) | F6 (2), W9 (2), G4 (3) | F4: broke main's web build · W2: broken fund link | 12 (+5, capped by rule 6) | **58.5** |
| Rabatou | F2 (3), B4 (3) | F5 (2), B5 (2), B1 (3), B2 (5), B3 (1), I2 (3) | – | ½ credit #91 (+0.25) | **6.25** |
| Kml221-bot | I1 (3), A4 (3), A3 (3), I3 (2), U0 (3) | F1 (3), F3 (2) | – | – | **14** |
| cheikhteej | – | – | – | – | **0** |
| **Shared pool** | | **28 pts → +7 each** | | | |

Update (Sun 18 Oct): Djbrl's 4 rule 11 reviews at 23:23 (#90, #76, #75, #85, logged in #77) add +2, capped at 5 by rule 6 → +1.5, Djbrl 35 → **36.5**.
Update (Sun 18 Oct): the W1, W3–W8, G1–G3, G5, A1, A2 subtotal is 30, not 29 (2+3+3+2+2+2+2 + 2+2+3+2 + 3+2, matches the issues' `pts:` labels; flagged by CodeRabbit, #92). Djbrl 57.5 → **58.5**.

Changes since 22:15: I1, A4, A3 merged with full points (fixes #99, #96, #97), I3 merged with full points (#93, fixes #101), I2 merged with done-when not met (fixes #98, 3 pts to the pool), F7 (#89) sized at 2 by the captain, Djbrl's reviews capped at 5 (rule 6). B2/B3 closed as not planned (replaced by B6/B7).

Since 02:15: A5 merged (#113). Wave 3b: U0 by Kml221-bot (#121, their commit), then L1, U1–U5 taken over by Djbrl as captain (one commit in 1h30 for 7 claimed tasks): U1 #125, U3 #126, U4 #127, U5 #123 merged with their done-when met.

L1 and U2 moved to earned at 11:30: screenshots at 1280/390 merged (#152) and the old landing now redirects to the app. Kml221-bot's U0 review fixes (#150) and CR10 seed guard (#151) merged with their commits.

Pending: B6 (Djbrl, 5, merged in #102, done-when needs a real production payment), D1–D7 (demo repo app install + funding, deck review, rehearsals, video, npm package, submission, trailer), unclaimed B7, I4.
To settle (rule 9): whether the finisher of a pooled task (F1, F3, B1, B5 were completed by Djbrl in #51, #72/#74, #80, #78) earns any of its points, or they stay in the pool.

#### Rule 11 verdicts on open PRs (Sat 17 Oct, 23:15)
Each PR was tested as pushed (install, lint, typecheck, tests, build, built server boots) and its feature was exercised by hand. Points only count once the PR is merged (rule 4).

| PR | Task (pts) | Author | Done-when at push | Bad break? | Verdict | Points once merged |
| --- | --- | --- | --- | --- | --- | --- |
| #90 | I1 (3) | Kml221-bot | Met: every page runs on live server data, with loading and error states (checked against a real server + Postgres) | No | **Full** | 3 |
| #76 | A4 (3) | Kml221-bot | Met: an agent key posts a bounty over MCP within its budget; bad key, over budget and a repo it isn't allowed are all refused | No | **Full** | 3 |
| #75 | A3 (3) | Kml221-bot | Met: issue, why it fits, criteria and an FCFA price on a real repo (offline heuristic; the Claude path was never run live) | No | **Full** | 3 |
| #85 | I2 (3) | Rabatou | **Not met**: the done-when says "in sandbox", and the PR says `--sandbox` was never run. Offline it is green 3 times in a row | A `/hold` during the objection window doesn't stop the payout (latent while the window is 0) | **Zero** → 3 pts to the pool | 0 |

| #93 | I3 (2) | Kml221-bot | Met: a failed payout that retries and a claim that expires both show on GitHub and the web | No | **Full** | 2 (merged) |

Rabatou also posted A3 review fixes in #91 (23:09), after Djbrl had taken over the remaining open PRs. #97 superseded it; Djbrl granted **half credit**: +0.25 (half of a rule 6 review bonus).
If all of them are merged as-is (before that +0.25): Kml221-bot **9**, Rabatou **6**, pool **28 pts → +7 each**.
To settle (rule 9): Rabatou may ask the 2 members not involved whether the offline run meets I2's intent, since Wave/OM sandbox payouts are now impossible. If yes, the `/hold` bug argues for half (1.5), not full.

---

## How to work
1. Pick an open task from [TASKS.md](TASKS.md) (or its GitHub issue once created). Assign yourself and comment "on it".
2. Branch `T-<ID>-short-name` (for example `T-B2-payouts`).
3. Give your agent the task row, [docs/plan.md](docs/plan.md) and the contract in `packages/core`. Commits start with the task ID: `B2: retry payouts 3 times`.
4. Before pushing: tests pass (`pnpm test`) or manual proof is attached, and docs are updated if needed.
5. Open **one PR for this task**, with the description: what changes, why, how to test it, which agent and model wrote it. Ask another member to review, and merge once it's been checked.
6. Standup every 2 hours, 5 minutes: done, in progress, blocked.

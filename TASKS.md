# Tasks

17 10 2026. Read with [docs/plan.md](docs/plan.md) (stack, contract, Bitnob calls) and [docs/product.md](docs/product.md).
Principle: **contract first, then everything is built against mocks and interfaces**, so any task can be picked up without waiting on someone else.

## The board, explained simply

**What it is.** 41 small jobs, each with a points value (1 to 5 for how big it is). Nobody owns an area. You take a job, have your AI agent write it, test it, document it, open one pull request, and a teammate checks it. Once it's merged, the points are yours. Points decide 80% of the prize.

**The 4 waves, in order.**
- **Wave 0, the foundations (6 jobs, 15:00–16:15).** Things everyone else needs: the rulebook (F2, do it first), the empty project online (F1), the database (F3), fake data for every page (F4), Bitnob answering (F5), the GitHub bot hearing comments (F6). One person per job, all at once.
- **Wave 1, the blocks (24 jobs, until midnight).** Four families you can pick from freely:
  - **B, money:** take payment over Lightning, pay out to Wave, the small test payment, the naira route from Lagos, Bitnob's notifications.
  - **G, GitHub:** understand the commands, write the bot's status comment, wire the two together, spot the fix and the merge, the 72-hour claim timer.
  - **A, AI:** Claude's check on a fix, showing it in the pull request, "Price my backlog", the server agents use to fund tasks, the agent demo.
  - **W, web pages:** the shared look, then one job per page from the mockups. All built on fake data, so they never wait for the back end.
- **Wave 2, plugging it together (4 jobs, overnight).** Real data in the pages, a script that runs the whole story end to end, the failure cases for the demo, the Lagos route on the live screen.
- **Wave 3, the show (7 jobs, Sunday morning).** Includes D7, the landing page (already live). The demo repo, the pitch slides, rehearsals, a backup video, the README, the submission.

**How to pick.** Take a job whose "depends on" jobs are done (or that only needs fake data). If you're blocked, take a W job, D1 (demo repo) or D2 (pitch). Watch the two paths everything waits on: rulebook → Bitnob → Wave payout, and GitHub bot → commands → merge detection.

**What counts.** One job = one pull request, tested and documented before you push, written by an AI agent. Otherwise no points.

---

**Task IDs:** the letter is the area, the number is the order within it. F = Foundations, B = Money (Bitnob), G = GitHub bot, A = AI, W = Web page, I = Integration, D = Demo & submission. Issue titles spell it out, e.g. "Money (Bitnob) · B2 · Payout pipeline with retries".

## Board rules
1. **One GitHub issue per task** (linked from each ID below), labels `pts:N`, `wave:N`, `area:…`. (Bonus pitch line: we split our own prize the way BitBounty works.)
2. **Claim** = assign yourself + comment "on it". **Multiple claims allowed**, but the 90-min stale rule applies to each one.
3. **Stale:** no commit or message for 90 min → the task goes back to the pool (points go to whoever finishes it).
4. **Done** = **one PR per task**, **tested** (passing tests or manual proof) and **documented** (PR description + docs updated) **before the push**, then **adversarial review** by **another** member (they try to break it and post what they tried) and merge. **No points otherwise.** The task ID prefixes every branch and commit: `B2: payout retries`.
5. **Points are fixed before 15:30** (sized by 2 people). A new task during the event = sized by 2 people before anyone takes it.
6. Standup **every 2 h, 5 min**: done / in progress / blocked.
7. **AI-only code**: every line is written by an agent; the PR names the agent and model. See the [README](README.md#ai-only-code).

## Points and prize
Points feed the prize split. The rules are in the [README](README.md#prize-agreement).

## Interfaces that make tasks independent
- `packages/core`: types (`Bounty`, `Funding`, `Claim`, `Submission`, `Payout`, `User`), state machine `transition(bounty, event)`, **internal events**: `bounty.created`, `funding.paid`, `claim.created`, `claim.expired`, `pr.linked`, `pr.merged`, `verify.done`, `payout.succeeded`, `payout.failed`.
- Modules talk **only through these events** (pg-boss queue). A module = a pure function + an adapter. You can build and test yours on its own.
- `fixtures/`: realistic JSON for every state (and every page). The web builds entirely on fixtures; plugging in the real API is a separate task (I1).
- Every external call (Bitnob, GitHub, Claude) sits behind an interface with a **fake** implementation for tests and the offline demo.

---

## Wave 0: foundations (15:00 → 16:15, the 4 in parallel)
| ID | Task | Pts | Depends on | Done when |
|---|---|---|---|---|
| [F1](https://github.com/Djbrl/bitbounty/issues/1) | Monorepo (pnpm, TS, lint) + Railway (server, Postgres) + Vercel (web) deploy + `.env.example` | 3 | – | "hello" deployed at both URLs |
| [F2](https://github.com/Djbrl/bitbounty/issues/2) | **Contract**: `packages/core` types + `transition()` + allowed-transitions table + events + unit tests | 3 | – | tests green, merged **first** |
| [F3](https://github.com/Djbrl/bitbounty/issues/3) | Drizzle schema + migrations + seed (bounties in every state) | 2 | F2 (types) | `pnpm db:seed` fills the DB |
| [F4](https://github.com/Djbrl/bitbounty/issues/4) | `fixtures/*.json` for every page + Next mock route `/api/*` serving them | 2 | F2 | every page can fetch its data |
| [F5](https://github.com/Djbrl/bitbounty/issues/5) | Bitnob: account, sandbox keys, HMAC client, `whoami` + test of the **4 key calls** (invoice, SN payout quote, VA simulate, NGN quote), results written in the README | 2 | – | 4 calls documented OK/KO |
| [F6](https://github.com/Djbrl/bitbounty/issues/6) | GitHub App: registration, permissions, webhook receiver (smee) + signature check + `events` table (dedupe) | 2 | F1 | a test comment shows up in `events` |
| [F7](https://github.com/Djbrl/bitbounty/issues/88) | **Bitnob sandbox proxy**: `/dev/bitnob/*` on the always-on server re-signs teammates' calls with its keys (IP allowlist + no shared secrets), token-gated, sandbox-only | 2 (proposed) | F5 F1 | whoami + invoice through the tunnel with token; 401/403/404 cases |

## Wave 1: parallel building (16:15 → 00:00)
### Money (Bitnob)
> Sat 17 Oct, 22:30: the mentor confirmed Wave / Orange Money payouts are not possible. Developers are paid **in sats over Lightning**: B6 replaces B2's mobile-money rail, B7 replaces B3's test-payout target. B6/B7 points to be sized by 2 members (rule 7).

| ID | Task | Pts | Depends on | Done when |
|---|---|---|---|---|
| [B1](https://github.com/Djbrl/bitbounty/issues/7) | Lightning funding: create invoice + polling job → `funding.paid` (+ conversion to USDT if possible) | 3 | F2 F5 | sandbox invoice paid → event emitted |
| [B2](https://github.com/Djbrl/bitbounty/issues/8) | Payout pipeline: quote → initialize → finalize, retries ×3, idempotency (`pay-<bounty>`), → `payout.succeeded/failed` | 5 | F2 F5 | sandbox payout OK + failure simulated |
| [B3](https://github.com/Djbrl/bitbounty/issues/9) | Test payout for onboarding (random 100–199 F) + confirmation endpoint | 1 | B2 | amount sent, then validated |
| [B4](https://github.com/Djbrl/bitbounty/issues/10) | NGN rail: customer + virtual account + simulate-deposit loop + NGN→BTC trade → `funding.paid` | 3 | F5 | NGN balance → BTC → event |
| [B5](https://github.com/Djbrl/bitbounty/issues/11) | Bitnob webhook receiver (payouts, deposits) + verification + dedupe | 2 | F6 | sandbox webhook recorded |
| [B6](https://github.com/Djbrl/bitbounty/issues/86) | **Lightning payouts** (replaces B2's Wave/OM rail): Lightning Address → LNURL-pay → BOLT11 → Bitnob `/api/lightning/pay`, never pay twice, `payout.*` events | 5 (proposed) | B1 B2 | sandbox Lightning payout paid, retry never pays twice |
| [B7](https://github.com/Djbrl/bitbounty/issues/87) | **Test payout in sats** to the developer's Lightning Address (replaces B3's target) + `/me` asks for a Lightning Address | 2 (proposed) | B6 | random sats sent, amount validated, lock holds under parallel guesses |

### GitHub
| ID | Task | Pts | Depends on | Done when |
|---|---|---|---|---|
| [G1](https://github.com/Djbrl/bitbounty/issues/12) | Command parser (`/bounty /claim /unclaim /extend /pay /hold /reject /criteria /cancel`) pure function + permissions + tests | 2 | F2 | tests green |
| [G2](https://github.com/Djbrl/bitbounty/issues/13) | Status-comment renderer (markdown per state, EN/FR) pure function + snapshots | 2 | F2 | snapshot of all 9 states |
| [G3](https://github.com/Djbrl/bitbounty/issues/14) | Wiring: comment → command → `transition()` → status comment edited + label | 3 | G1 G2 F6 | `/bounty 10000` on a real issue → comment + label |
| [G4](https://github.com/Djbrl/bitbounty/issues/15) | PR detection ("Fixes #n"), submission, merge → `pr.merged`, missing-link case | 3 | F6 F2 | merging a test PR → event |
| [G5](https://github.com/Djbrl/bitbounty/issues/16) | Claim timer (72 h, demo 5 min) + expiry + `/extend` | 2 | G3 | claim expired → issue unassigned |

### AI (Claude)
| ID | Task | Pts | Depends on | Done when |
|---|---|---|---|---|
| [A1](https://github.com/Djbrl/bitbounty/issues/17) | Verifier: prompt + strict JSON schema + `verify(issue, criteria, diff, ci)` + 5 fixtures (pass / fail / unsure) | 3 | F2 | 5/5 fixtures as expected |
| [A2](https://github.com/Djbrl/bitbounty/issues/18) | GitHub Check Run publisher (success / failure / neutral) on every push | 2 | A1 F6 | check visible on a PR |
| [A3](https://github.com/Djbrl/bitbounty/issues/19) | "Price my backlog": read open issues → keep the good ones → criteria + FCFA price + reason | 3 | F2 | JSON of suggestions on the demo repo |
| [A4](https://github.com/Djbrl/bitbounty/issues/20) | MCP server (`post_bounty`, `get_bounty`, `cancel_bounty`) + `/v1` API with agent key + budget | 3 | F2 | Claude Code funds a bounty through MCP |
| [A5](https://github.com/Djbrl/bitbounty/issues/21) | Agent demo scenario (Claude Code in the demo repo, Wolof task) written + tested | 2 | A4 D1 | the scenario runs 2× in a row |

### Web (built on fixtures, styled from the build kit)
| ID | Task | Pts | Depends on | Done when |
|---|---|---|---|---|
| [W1](https://github.com/Djbrl/bitbounty/issues/22) | Tokens + layout + base components (cards, pills, status, table, phone frame) | 2 | F1 | storybook page or /dev |
| [W2](https://github.com/Djbrl/bitbounty/issues/23) | Maintainer dashboard + "Price my backlog" (selection, bottom bar, "Fund N bounties") | 3 | W1 F4 | matches mockup 1, on fixtures |
| [W3](https://github.com/Djbrl/bitbounty/issues/24) | Fund page: 3 tabs (Lightning QR auto-refresh, USDT, naira account), summary, status polling | 3 | W1 F4 | matches mockup 3, on fixtures |
| [W4](https://github.com/Djbrl/bitbounty/issues/25) | Developer onboarding /me (FR): provider, number, OTP (mock), test amount | 3 | W1 F4 | matches mockup 4 |
| [W5](https://github.com/Djbrl/bitbounty/issues/26) | Bounty page /b/[id] (timeline) + receipt /r/[id] | 2 | W1 F4 | both pages on fixtures |
| [W6](https://github.com/Djbrl/bitbounty/issues/27) | Public board + live feed | 2 | W1 F4 | matches mockup 7 |
| [W7](https://github.com/Djbrl/bitbounty/issues/28) | Proof-of-work profile /u/[login] | 2 | W1 F4 | matches mockup 8 |
| [W8](https://github.com/Djbrl/bitbounty/issues/29) | /live projector screen (SSE, cards moving between columns) | 2 | W1 F4 | the cards move on a fake event |
| [W9](https://github.com/Djbrl/bitbounty/issues/30) | GitHub OAuth (Auth.js) + session + web/user link | 2 | F1 | log in / log out works |

## Wave 2: integration (00:00 → 08:00)
| ID | Task | Pts | Depends on | Done when |
|---|---|---|---|---|
| [I1](https://github.com/Djbrl/bitbounty/issues/31) | Replace the web mocks with the real API (`/api/*` on the server) | 3 | W* + server | all pages on real data |
| [I2](https://github.com/Djbrl/bitbounty/issues/32) | End-to-end happy-path script (sandbox): fund → claim → PR → verify → merge → paid | 3 | B1 B2 G3 G4 A2 | script green 3× in a row |
| [I3](https://github.com/Djbrl/bitbounty/issues/33) | Error paths for the demo: payout failed then retried, claim expired | 2 | I2 | both cases shown cleanly |
| [I4](https://github.com/Djbrl/bitbounty/issues/34) | Lagos route end to end (NGN → BTC → XOF) in the UI | 2 | B4 I1 | visible on /live |

## Wave 3: demo and submission (08:00 → 14:00)
| ID | Task | Pts | Depends on | Done when |
|---|---|---|---|---|
| [D1](https://github.com/Djbrl/bitbounty/issues/35) | Demo repo: seed issues (criteria, a real small bug to fix, the Wolof task) | 2 | – (from 16:00) | repo ready, issues created |
| [D2](https://github.com/Djbrl/bitbounty/issues/36) | Pitch deck (5–6 slides: maintainer pain, demo, Bitnob in depth, traction/vision, team) | 3 | – | deck reviewed by 2 people |
| [D3](https://github.com/Djbrl/bitbounty/issues/37) | Demo script + 3 timed rehearsals (3 min) | 2 | I2 | 3 rehearsals ≤ 3:00 |
| [D4](https://github.com/Djbrl/bitbounty/issues/38) | Backup video of the full loop (recording + editing) | 2 | I2 | video ≤ 2 min, link ready |
| [D5](https://github.com/Djbrl/bitbounty/issues/39) | README, LICENSE, architecture diagram, setup guide, `bitnob` package published | 2 | – | a stranger can run it locally |
| [D6](https://github.com/Djbrl/bitbounty/issues/40) | Submission form + links checked in private browsing | 1 | all | submitted before 14:00 |
| [D7](https://github.com/Djbrl/bitbounty/issues/41) | Landing page: scrollytelling story, French, live on Vercel ([site](https://bitbounty-nine.vercel.app), [repo](https://github.com/Djbrl/bitbounty-landing)) | 5 | – | live + public; demo link and trailer filled in; adversarial review on the issue |

**Total = 101 pts.** Wave 0 = 14, wave 1 = 60, wave 2 = 10, wave 3 = 17, plus reviews. Average ≈ 25 pts per person.

## Suggested start (people stay free to switch)
- 15:00 → 16:15: **one of the F's each** (F2 first and fast: everyone reviews it at 15:45).
- Then, **lanes** for momentum, not ownership: Money (B*), GitHub (G*), AI (A*), Web (W*). D1 and D2 can be taken by whoever is waiting on a dependency.
- Critical path to watch: **F2 → F5 → B2** (payout) and **F6 → G3 → G4** (GitHub). Everything else goes around them.

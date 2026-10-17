# BitBounty

**Algora for West Africa, with Bitnob at the core.** The marketplace where open-source developers find paid issues and get paid in local currency on mobile money the moment their fix merges.

BitBounty is a GitHub App for maintainers. Claude reads your open issues and suggests which ones to put a bounty on, with acceptance criteria and a price. You fund them in one payment, over Lightning, USDT or a naira bank transfer. African developers pick them up, and whoever gets their fix merged is paid in local currency to Wave or Orange Money through [Bitnob](https://bitnob.dev), minutes after the merge.

Built at **Code & Chain Dakar 2026** (Bitnob), 17–18 Oct 2026. Hacking starts Sat 15:00, submission Sun 14:00, demo Sun 15:00.

| | |
| --- | --- |
| [TASKS.md](TASKS.md) | The task board: 41 tasks, points, dependencies, definition of done |
| [docs/plan.md](docs/plan.md) | Stack, contract, data model, exact Bitnob calls, timeline, demo script |
| [docs/product.md](docs/product.md) | Product definition, UX flows, edge cases, positioning |
| [docs/bitnob-api.md](docs/bitnob-api.md) | Bitnob API cheat sheet |
| [docs/setup.md](docs/setup.md) | Run locally, commands, deploy to Railway and Vercel |
| [docs/auth.md](docs/auth.md) | Sign in with GitHub (Auth.js), session fields, env and one-time setup |

Status: **monorepo scaffolded** (`apps/web`, `apps/server`). Run it with `pnpm install && pnpm dev`, see [docs/setup.md](docs/setup.md).

---

## The plan, explained simply

**The picture.** BitBounty is a notary with a safe, sitting between GitHub and Bitnob. GitHub is the workshop: issues, fixes and merges happen there. Bitnob is the bank: money comes in and goes out to Wave. BitBounty holds the money in its safe, watches the workshop, and when the job is done tells the bank to pay the developer.

**The 5 building blocks.**
1. **The rulebook (the contract).** The stages a bounty goes through: unfunded → funded → claimed → fix submitted → checked → paid. Written first, at 15:00. Everyone builds against it.
2. **The GitHub bot.** Reads `/bounty` and `/claim`, keeps one status comment per issue up to date, notices when a fix is merged.
3. **The cash desk (Bitnob).** Creates the Lightning invoice the maintainer pays, notices when the money arrives, pays the developer to Wave when the bot says so. Also handles a naira bank transfer from Lagos.
4. **Claude.** "Price my backlog" reads the open issues and suggests which ones to fund, with criteria and a price. On every fix, it says whether each criterion is met.
5. **The web pages.** Maintainer dashboard, payment page, developer Wave setup, public board, profile, and the big live screen for the demo.

**How the blocks talk.** They don't call each other. They leave notes on a shared board ("money received", "fix merged", "check OK", "payment sent"), and each block watches for the notes it cares about. So everyone builds and tests their block alone with fake notes, and it all clicks together at the end. Web pages start on fake data too; the real data is plugged in overnight.

**The order.**
- **15:00–16:15, foundations:** the rulebook, the empty project already online, the fake data, Bitnob answering (invoice, Wave payout, naira account), the bot receiving GitHub's notifications.
- **16:15–midnight, everyone builds a block.** Goal at midnight: one bounty that goes all the way from funded to paid in the sandbox.
- **Midnight–08:00:** real data in the pages, the agent that funds a task itself, the Lagos route (naira → bitcoin → FCFA), a full test. Sleep in shifts.
- **08:00–13:00:** polish, demo repo, pitch, 3 rehearsals, backup video, README.
- **13:00 code freeze. 14:00 submitted. 15:00 demo.**

**The 3 things that can block everything.** Paying out to Wave from Bitnob's sandbox (check it at their 11:00 demo). The GitHub bot receiving notifications (set up in the first hour). Venue Wi-Fi (deploy online right away, keep a phone hotspot, record a backup video). If one breaks, the rest can still be built, because every block runs on fake notes.

The full technical plan is in [docs/plan.md](docs/plan.md).

---

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
Status at Sat 17 Oct, 22:15, with rule 11 applied to every merged PR (per-PR audit: who wrote it, clean or fixed, breaks, done-when at push).

| Member | Earned | Lost to the pool (done-when not met at push) | Halved (bad break) | Reviews | Points |
| --- | --- | --- | --- | --- | --- |
| Djbrl | W1, W3–W8, G1–G3, G5, A1, A2 (29) · F4 ½ (1) · W2 ½ (1.5) | F6 (2), W9 (2), G4 (3) | F4: broke main's web build · W2: broken fund link | 7 (+3.5) | **35** |
| Rabatou | F2 (3), B4 (3) | F5 (2), B5 (2), B1 (3), B2 (5), B3 (1) | – | – | **6** |
| Kml221-bot | – (A3, A4, I1 open) | F1 (3), F3 (2) | – | – | **0** |
| cheikhteej | – | – | – | – | **0** |
| **Shared pool** | | **25 pts → +6.25 each** | | | |

Pending: D7 landing (Djbrl, 5), A3/A4/I1 (Kml221-bot), I2 (Rabatou), B2/B3 done-when (blocked: Wave/OM not usable), unclaimed A5, I3, I4, D1–D6.
To settle (rule 9): whether the finisher of a pooled task (F1, F3, B1, B5 were completed by Djbrl in #51, #72/#74, #80, #78) earns any of its points, or they stay in the pool.

--- | --- | --- | --- |
| Djbrl | F4, F6, W1–W9, G1–G5, A1, A2 (42) · F1 deploy + F3 finish (split to agree, up to 5) · D7 landing (5, pending trailer + review) | – | 42 (+ up to 10) |
| Rabatou | F2, F5 (5) · B1–B5 open | – | 5 |
| Kml221-bot | F1 monorepo #46 (split to agree, up to 3) · F3 base #49 (split to agree, up to 2) · A3, A4 open | – | 0 (+ up to 5) |
| cheikhteej | – | – | 0 |

---

## How to work
1. Pick an open task from [TASKS.md](TASKS.md) (or its GitHub issue once created). Assign yourself and comment "on it".
2. Branch `T-<ID>-short-name` (for example `T-B2-payouts`).
3. Give your agent the task row, [docs/plan.md](docs/plan.md) and the contract in `packages/core`. Commits start with the task ID: `B2: retry payouts 3 times`.
4. Before pushing: tests pass (`pnpm test`) or manual proof is attached, and docs are updated if needed.
5. Open **one PR for this task**, with the description: what changes, why, how to test it, which agent and model wrote it. Ask another member to review, and merge once it's been checked.
6. Standup every 2 hours, 5 minutes: done, in progress, blocked.

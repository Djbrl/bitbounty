# BitBounty

**Put a price on your backlog. Pay only when it merges.**

BitBounty is a GitHub App for maintainers. Claude reads your open issues and suggests which ones to put a bounty on, with acceptance criteria and a price. You fund them in one payment, over Lightning, USDT or a naira bank transfer. African developers pick them up, and whoever gets their fix merged is paid in local currency to Wave or Orange Money through [Bitnob](https://bitnob.dev), minutes after the merge.

Built at **Code & Chain Dakar 2026** (Bitnob), 17–18 Oct 2026. Hacking starts Sat 15:00, submission Sun 14:00, demo Sun 15:00.

| | |
| --- | --- |
| [TASKS.md](TASKS.md) | The task board: 33 tasks, points, dependencies, definition of done |
| [docs/plan.md](docs/plan.md) | Stack, contract, data model, exact Bitnob calls, timeline, demo script |
| [docs/product.md](docs/product.md) | Product definition, UX flows, edge cases, positioning |
| [docs/bitnob-api.md](docs/bitnob-api.md) | Bitnob API cheat sheet |

Status: **no product code yet**. The organisers' rule is that the project is built during the hackathon, so this repo holds only the plan until Saturday 15:00.

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
4. **Points count when a task is done**: PR merged and checked by another member. Non-code tasks (pitch, video, demo, README, submission) earn points like any other.
5. **Reviews are worth +0.5 points each**, capped at 5 points per person.
6. **Task points are fixed before 15:30 on Saturday**, agreed by 2 members. A task added later is sized by 2 members before anyone takes it. Points don't change after the task is claimed.
7. **Stale tasks:** a claimed task with no commit or message for 90 minutes goes back to the pool. Its points go to whoever finishes it.
8. **Disputes** about a task are settled by the 2 members not involved in it. Their decision is final.
9. The final points tally is written in this README before 14:00 on Sunday and agreed by all 4 members before any money is shared.

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
| Member | Tasks done | Reviews | Points |
| --- | --- | --- | --- |
| | | | |
| | | | |
| | | | |
| | | | |

---

## How to work
1. Pick an open task from [TASKS.md](TASKS.md) (or its GitHub issue once created). Assign yourself and comment "on it".
2. Branch `T-<ID>-short-name` (for example `T-B2-payouts`).
3. Give your agent the task row, [docs/plan.md](docs/plan.md) and the contract in `packages/core`. Commits start with the task ID: `B2: retry payouts 3 times`.
4. Open a PR saying which agent and model wrote it, ask another member to review, and merge once it's been checked.
5. Standup every 2 hours, 5 minutes: done, in progress, blocked.

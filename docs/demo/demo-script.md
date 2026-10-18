# Demo script (D3): 3 minutes on stage

Demo Day, Sunday 18 Oct, 15:00. One presenter talks, one drives the laptop. Rehearse 3 times, timed (done-when: 3 runs ≤ 3:00).
**Demo repo = our own repo, `Djbrl/bitbounty`** (captain's call, Sun 11:45): its open CodeRabbit issues are a real maintainer backlog. Stage issues: **CR6 #134** is the live fix (unfunded, don't fix it before the demo), **CR12 #140** is the agent's (no bounty yet, don't touch), **CR8 #136** (10 000) and **CR15 #148** (15 000) are pre-funded. Fallback repo: `Djbrl/bitbounty-demo` (issue 1 live bug, issue 2 agent, #3 and #4 funded).

Lines marked **[check in rehearsal]** depend on something not yet proven live; replace them with the fallback if they fail during rehearsal.

## Before going on stage (T-15 min)
- [ ] Server healthy: `curl <tunnel>/health` → ok. Board open on https://bitbounty-app.vercel.app (seed data: 3 paid bounties, 43 000 FCFA).
- [ ] Tabs open, in order: (1) landing, (2) the open CodeRabbit issues on `Djbrl/bitbounty` (filter `CR`) and issue #134, (3) the developer's editor (or Claude Code) on `bitbounty` with the CR6 fix ready, (4) `/live` on the big screen, (5) Claude Code with the BitBounty MCP server ([agent-demo.md](agent-demo.md)), (6) the phone with Blink, mirrored if possible.
- [ ] Two GitHub accounts signed in: maintainer (Djbrl) and developer (second browser profile).
- [ ] Backup video (D4) on the desktop, one click away.
- [ ] Phone hotspot ready (venue Wi-Fi blocks QUIC; the tunnel already runs over HTTP/2).

## The run (3:00)

| Time | On screen | Say (roughly) |
| --- | --- | --- |
| 0:00–0:25 | Landing | "Open-source maintainers in Africa have issues piling up and no way to pay the developers next door. Developers in Dakar or Lagos can't get paid for a fix. BitBounty puts a price on a GitHub issue, and pays the fix in sats over Lightning, on merge." |
| 0:20–0:30 | Our CodeRabbit issues | "This is our own repo. An AI reviewer found 15 problems overnight. Who fixes them, and who pays?" Optional: "Price my backlog" on `/app/maintain` prices them in a few seconds. |
| 0:30–0:45 | Issue #134 (CR6) on `bitbounty` | Maintainer comments `/bounty 10000`. "One comment. The bot answers with a Lightning invoice through Bitnob, priced in FCFA, paid in sats." Fund it. **[check in rehearsal]**: sandbox invoice paid with `auto_settle`/simulate; fallback: show #136, already funded. |
| 0:45–1:05 | Same issue, developer account | `/claim`. "Awa in Dakar claims it. She has 72 hours; the bot assigns her and starts the clock." |
| 1:05–1:35 | Editor → PR | In `apps/web/components/fund/fund-view.tsx`, only active funded statuses get the "held by Bitnob / claim it" panel; paid / cancelled / refunded get a short accurate message. Push, open the PR with `Fixes #134`. "The fund page told people they could claim a bounty that was already paid." |
| 1:35–2:00 | PR checks | "CI is green, and Claude reads the PR against the issue's acceptance criteria. It advises; the maintainer decides." Show the BitBounty check run: every criterion met. |
| 2:00–2:20 | Merge → `/live` + phone | Merge. "On merge, BitBounty converts 10 000 FCFA to sats at Bitnob's rate and pays Awa's Lightning Address." **[check in rehearsal]**: the real payment needs Bitnob production; fallback: show a seeded paid bounty and its receipt, say "this is what Awa gets". |
| 2:20–2:45 | Claude Code (agent demo) | "Agents can fund work too." Prompt from [agent-demo.md](agent-demo.md): Claude Code puts 15 000 FCFA on CR12 (#140) within its budget, then is refused when it asks 10 000 more for CR11 (#139). |
| 2:45–3:00 | Board | "Funding from Lagos in naira, payouts in sats, the AI checks, humans decide. All of it on Bitnob, all of the code written by AI agents. BitBounty: get paid to fix open source, from Dakar." |

## If something breaks
| Problem | Do this |
| --- | --- |
| Tunnel or server down | Switch to the backup video at the current step. Don't debug on stage. |
| Bot doesn't answer `/bounty` within 10 s | Say "the webhook is on its way", move to the already-funded #136. |
| Claude check slow | Show the check run of a rehearsal PR (keep one open, unmerged). |
| Payout doesn't arrive | Show the seeded paid bounty's receipt (`/r/<id>`), mention the sats amount and the Lightning Address. |
| Claude Code / MCP not available | Run `pnpm --filter @bitbounty/server agent:demo` (scripted fallback, same calls). |
| No naira-funded bounty on `/live` for the "Funding from Lagos" line | Run `pnpm --filter @bitbounty/server e2e -- --fund=ngn --runs=2 --serve=8794 --pace=1500` and point a web at it (`BITBOUNTY_API_URL=http://localhost:8794`): `/live` plays two Lagos bounties and shows the **Lagos → Dakar** route (₦27 000 → 18 000 sats → 10 000 F, paid as 16 666 sats) with the sums under it (I4, [e2e README](../../apps/server/src/e2e/README.md#lagos-route-on-live-i4)). |

## Questions to prepare (30 s answers)
- **Why sats, not mobile money?** Bitnob pays Lightning instantly and everywhere; mobile-money payouts weren't available to us. The developer can cash out locally if they want.
- **What stops a bad fix from being paid?** A human merge. Claude only advises; `/hold` stops a payout during the objection window.
- **Double payments?** One payout per bounty, compare-and-set in Postgres, the same invoice reused on retry, a sats cap.
- **Business model?** A small fee on funded bounties (to decide; don't promise numbers).
- **Partnerships?** None. Bitnob is the payment infrastructure we built on; Btrust's mission is our inspiration, not an affiliation.

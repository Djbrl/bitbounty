# Backup video (D4): shot list

Done-when: a video of the full loop, **2 minutes or less**, link ready. Record it right after the first good rehearsal (D3), with the same steps as [demo-script.md](demo-script.md), so the stage team can switch to it at any step.

## Setup
- Screen recorder at 1920×1080, 30 fps, system audio off; record voice separately or live, in French or English (pick one, subtitles in the other if time allows).
- Browser zoom 125%, bookmarks bar hidden, notifications off (macOS Focus mode).
- Two browser profiles: maintainer (Djbrl) and developer.
- Tunnel healthy (`/health`), board showing the seed data, demo repo with the GitHub App installed.

## Shots (target times)
| # | Time | Shot | Voice-over (short) |
| --- | --- | --- | --- |
| 1 | 0:00–0:10 | Landing hero | "BitBounty: get paid to fix open source, from Dakar." |
| 2 | 0:10–0:25 | `Djbrl/bitbounty` issue #134 (CR6, found by CodeRabbit), comment `/bounty 10000` | "A maintainer prices an issue with one comment." |
| 3 | 0:25–0:40 | Bot reply + paying the invoice | "The bot answers with a Lightning invoice from Bitnob." |
| 4 | 0:40–0:50 | Developer comments `/claim` | "A developer in Dakar claims it." |
| 5 | 0:50–1:10 | Editor: the one-character fix + test, push, PR with `Fixes #1` | "The fix is one character." |
| 6 | 1:10–1:25 | PR checks: CI green + BitBounty check, criteria met | "Claude checks the PR against the criteria. The maintainer decides." |
| 7 | 1:25–1:40 | Merge → status comment "paid" + receipt; phone with Blink if the real payout works | "On merge, the developer is paid in sats over Lightning." |
| 8 | 1:40–1:55 | Claude Code funding CR12 (#140) through MCP, then refused over budget | "Agents can fund work too, within a budget." |
| 9 | 1:55–2:00 | Board | "Built on Bitnob. Code written by AI agents." |

## If the real payout isn't available
At shot 7, show a seeded paid bounty and its receipt (`/r/<id>`) and say "this is what the developer receives". Don't fake a phone notification.

## Export
MP4, H.264, ≤ 100 MB. Upload unlisted to YouTube, put the id in `bitbounty-landing/site.config.js` (`trailerYoutubeId`) and the link in [submission.md](submission.md).

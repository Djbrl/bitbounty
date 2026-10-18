# GitHub App

The bot is the GitHub App **BitBounty Dakar** ([github.com/apps/bitbounty-dakar](https://github.com/apps/bitbounty-dakar), public, owner @Djbrl). It receives webhooks at `POST /webhooks/github` on `apps/server`, checks the `X-Hub-Signature-256` HMAC, stores each delivery once in the `events` table (dedupe on `X-GitHub-Delivery`), then dispatches it.

## Registration
| Field | Value |
| --- | --- |
| App ID | `5360174` → `GITHUB_APP_ID` |
| Client ID | `Iv23liCkNNOVL2DflyZ1` → `GITHUB_CLIENT_ID`, also `AUTH_GITHUB_ID` for sign-in ([auth.md](auth.md)) |
| Webhook URL | a smee channel, kept only in `.env` as `WEBHOOK_PROXY_URL`. Never commit it: smee has no auth, so the URL alone lets anyone read every payload (a test checks no channel URL is committed) |
| Callback URLs | `http://localhost:3000/api/auth/callback/github`, `https://bitbounty-app.vercel.app/api/auth/callback/github` |

**Repository permissions:** Issues read & write · Pull requests read & write · Checks read & write · Contents read-only · Metadata read-only.
**Events:** Issue comment · Issues · Pull request · Pull request review · Check suite (installation events are always sent).

To run your own copy, register a new app at https://github.com/settings/apps/new with these values, then:
1. Webhook secret: `openssl rand -hex 32`, in the app settings and in `.env` as `GITHUB_WEBHOOK_SECRET`.
2. Private key: generate one in the app settings and put it in `.env` as `GITHUB_PRIVATE_KEY`, one line with `\n` or base64.
3. Install the app on a test repo.

## Receive webhooks locally
```sh
npx smee-client --url "$WEBHOOK_PROXY_URL" --target http://localhost:8787/webhooks/github
```
Or, for a receiver that only logs events (in-memory store, port 3001): `pnpm --filter @bitbounty/server dev:webhook`. Only one person should forward a shared channel at a time, or each delivery is processed several times.

Check: comment `/bounty 10000` on an issue; the event is stored once (`select id, type, action, repo, status from events order by id desc limit 5;`). Redelivering it from the app's *Advanced* tab answers `{"ok":true,"duplicate":true}`. A forged signature gets `401`.

A handler that throws marks the event `failed` and returns 500, so GitHub's redelivery retries it; a `processed` event is never re-run.

## Comment commands (`src/github/wiring/`)
Active only when `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY` and `GITHUB_WEBHOOK_SECRET` are set.

| Command | Who | Effect |
| --- | --- | --- |
| `/bounty <FCFA>` | write access | creates the bounty (`unfunded`) and the status comment with a fund link |
| `/claim`, `/unclaim` | anyone | takes or releases the issue (one active claim, `CLAIM_TTL_MINUTES`, default 72 h) |
| `/extend` | claimant or maintainer | pushes the deadline back by one claim length, once |
| `/pay [@user]`, `/hold`, `/reject` | write access | approve a payout, stop it, or reopen the bounty for a new claimant |
| `/cancel` | write access | before any PR: `cancelled` if unfunded, `refunded` if funded (no money is moved automatically) |
| `/funded` | write access, sandbox keys only | settles the open Lightning invoice with Bitnob's `simulate-payment` |

The author's real repo permission is read from GitHub, so an org member with write access counts as a maintainer. Every status change goes through `transition()` with a compare-and-set save. The bot keeps **one status comment** per issue, edited in place, plus one `bounty: <status>` label and a `💰 <amount> FCFA` label. Errors get a short `@user …` reply. `/criteria` is parsed but not implemented (it replies so). Env: `WEB_BASE_URL` (links), `BOT_LANG` (`en` | `fr`), optional `GITHUB_BOT_LOGIN`.

## PR detection and merge (`src/github/pr/`)
| Webhook | Effect |
| --- | --- |
| PR opened / edited / pushed / reopened with `Fixes #n` (or closes / resolves, `owner/repo#n`, full issue URL), author is the claimant | bounty `submitted`, `pr.linked` (verdict reset on each push) |
| same, author isn't the claimant | not linked; polite comment on the PR |
| same, bounty funded but unclaimed | not linked; comment pointing to `/claim` |
| linked PR merged | `pr.merged` with merge sha, author, merger and whether CI is green (our own check excluded) |
| merged without a link | comment on the issue: "Is PR #34 the fix for #12? `/pay @awa`" |

References inside code blocks and HTML comments are ignored.

## Verification check run (`src/ai/check-run/`)
On PR opened / pushed / reopened, when the PR closes an issue with a live bounty:
1. creates the check **"BitBounty verification"** `in_progress` on the head sha;
2. after answering the webhook (GitHub's 10 s limit), fetches the diff and CI status and runs the verifier against the issue's criteria (its "Done when" list when none are stored);
3. completes it: `pass` → success, `fail` → failure, `unsure` → neutral, listing each criterion with evidence and saying a human decides;
4. publishes `verify.done`.

A newer push marks older runs `skipped`. Verifier down, diff unreadable or any crash → `neutral`, never a false failure. The verifier is Claude when `ANTHROPIC_API_KEY` is set, else an offline heuristic (the check says so). `CHECK_RUN_DEMO_LOOKUP=issue` is a demo switch that treats any linked issue as funded.

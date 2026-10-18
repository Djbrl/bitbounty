# GitHub App: setup and local webhooks (F6)

The bot is a GitHub App. It receives webhooks at `POST /webhooks/github` on `apps/server`,
checks the `X-Hub-Signature-256` HMAC, stores each delivery once in the `events` table
(dedupe on `X-GitHub-Delivery`), then hands it to the dispatcher (G3, G4, A2 plug in there).

## 1. The app (already registered)

| Field | Value |
|---|---|
| Name / slug | BitBounty Dakar / `bitbounty-dakar` (owner @Djbrl) |
| App ID | `5360174` → `GITHUB_APP_ID` |
| Client ID | `Iv23liCkNNOVL2DflyZ1` → `GITHUB_CLIENT_ID` |
| Visibility | Public (any account can install it) |
| Webhook URL | `https://smee.io/gk8M8VuUD4ZMaO7A` → `WEBHOOK_PROXY_URL` (the Docker `smee` service forwards it to the server, see [setup.md](setup.md)) |
| Callback URLs (OAuth, W9) | `http://localhost:3000/api/auth/callback/github` · to add: `https://bitbounty-app.vercel.app/api/auth/callback/github` (see [auth.md](auth.md)) |
| Settings page | https://github.com/settings/apps/bitbounty-dakar |

**Repository permissions:** Issues read & write · Pull requests read & write · Checks read & write ·
Contents read-only · Metadata read-only.

**Subscribed events:** Issue comment · Issues · Pull request · Pull request review · Check suite.
(`installation` / `installation_repositories` events are always sent to GitHub Apps, no checkbox needed.)

If you ever need to register a new one: https://github.com/settings/apps/new with the values above,
"Where can this GitHub App be installed?" = Any account.

## 2. Remaining manual steps (owner only, secrets never committed)

1. **Webhook secret.** Generate one: `openssl rand -hex 32`. Paste it in the app settings → *Webhook secret*
   → Save. Put the same value in your local `.env` (and the server's `.env`) as `GITHUB_WEBHOOK_SECRET`.
   Share it with the team over a private channel, not in the repo.
2. **Private key.** App settings → *Private keys* → *Generate a private key* (downloads a `.pem`).
   Put it in `.env` as `GITHUB_PRIVATE_KEY`, either one line with `\n`:
   `awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' bitbounty-dakar.*.pem`
   or base64: `base64 -i bitbounty-dakar.*.pem | tr -d '\n'`. Both forms are accepted.
3. **Install on the demo repo.** https://github.com/apps/bitbounty-dakar/installations/new →
   pick the demo repo (only select repositories). Installing sends an `installation` event.

## 3. Receive webhooks locally (smee)

```bash
cp .env.example .env            # then fill GITHUB_WEBHOOK_SECRET (+ GITHUB_PRIVATE_KEY)
pnpm install                    # at the repo root

# terminal 1: the receiver (in-memory store, logs each event)
pnpm --filter @bitbounty/server dev:webhook   # → http://localhost:3001/webhooks/github

# terminal 2: forward smee → local
npx smee-client --url https://smee.io/gk8M8VuUD4ZMaO7A --target http://localhost:3001/webhooks/github
```

The main server (`apps/server/src/app.ts`) mounts `githubWebhookRoutes(...)` with `DrizzleEventStore`
when `DATABASE_URL` is set, so rows land in the Postgres `events` table; point `--target` at that server's port instead.

Note: only one person should run the smee client against the shared channel at a time, or
each delivery gets processed by several laptops.

## 4. Check it works (the F6 "done when")

1. Comment `/bounty 10000` on an issue of the repo where the app is installed.
2. Terminal 1 prints `[github] #1 issue_comment.created <owner>/<repo> inst=<id> delivery=<uuid> "/bounty 10000"`.
   With Postgres: `select id, type, action, repo, status from events order by id desc limit 5;` shows it once.
3. App settings → *Advanced* → *Recent Deliveries* → *Redeliver* the same delivery: response is
   `{"ok":true,"duplicate":true}` and nothing new is stored.
4. Forged payload: `curl -X POST localhost:3001/webhooks/github -H 'X-GitHub-Event: issue_comment' -H 'X-GitHub-Delivery: x' -H 'X-Hub-Signature-256: sha256=00' -d '{}'` → `401`.

## 5. For G3 / G4 / A2: plugging in

```ts
import { GithubDispatcher, githubWebhookRoutes, createGithubApp } from "./github/index.js";
import { DrizzleEventStore } from "./github/index.js";  // events table from @bitbounty/db

const gh = createGithubApp();                       // reads GITHUB_APP_ID / _PRIVATE_KEY / _WEBHOOK_SECRET
const dispatcher = new GithubDispatcher()
  .on("issue_comment.created", async (e) => { /* G3: parse command */ })
  .on("pull_request", async (e) => { /* G4: opened/synchronize/closed; A2: check run */ });
app.route("/", githubWebhookRoutes({ secret: process.env.GITHUB_WEBHOOK_SECRET!, store: new DrizzleEventStore(db), dispatcher }));

// inside a handler, act as the bot on that installation:
const octokit = await gh.getInstallationOctokit(e.installationId!);
```

Handler keys: `"*"`, `"<event>"` or `"<event>.<action>"`. A handler that throws marks the event
`failed` and returns 500, so GitHub's redelivery retries it; a `processed` event is never re-run.
Keep handlers quick (enqueue to pg-boss for slow work): GitHub times out after 10 s.

## 6. PR detection and merge (G4)

`apps/server/src/github/pr/` registers on `githubDispatcher` for `pull_request` and publishes on
`eventBus` (exported from `app.ts`; in-memory until pg-boss, same `publish`/`subscribe` interface).

| Webhook | Effect |
|---|---|
| `opened` / `edited` / `synchronize` / `reopened`, body or title says `Fixes #n` (or closes/resolves, `owner/repo#n`, full issue URL) | if the bounty on #n is `claimed`/`submitted` and the PR author is the claimant → bounty `submitted`, `pr.linked` (new head sha on each push, verdict reset) |
| same, PR author isn't the claimant | no link; polite comment on the PR (on `opened`/`reopened` only) |
| same, bounty `funded` but unclaimed | no link; comment pointing to `/claim` |
| same, bounty `unfunded` / no bounty / cross-repo ref | ignored |
| `closed` + `merged` on the linked PR | `pr.merged` with `mergeSha`, `authorLogin`, `mergedByLogin`, `ciGreen` (check runs + statuses on the head sha, our own check excluded) |
| `closed` + `merged`, not linked (no `Fixes #n`, or by a non-claimant) | comment on the issue: "Is PR #34 the fix for #12? `/pay @awa`" |
| `closed` without merge | nothing; reopening relinks |

Refs inside code, fenced blocks and HTML comments (PR templates) are ignored. One keyword per
issue, like GitHub: `Fixes #1, fixes #2` links both, `Fixes #1, #2` only #1. Bounty lookups go
through `BountyRepo` (in-memory until F3). Comments use the App installation when
`GITHUB_APP_ID`/`GITHUB_PRIVATE_KEY` are set, otherwise they are logged.

## 7. Comment commands (G3)

`apps/server/src/github/wiring/` registers `issue_comment.created` on `githubDispatcher` (only when
`GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY` and `GITHUB_WEBHOOK_SECRET` are set):

1. Comments by bots, or without a command line, are dropped before any API call.
2. The author's real repo permission is read (`GET /repos/{o}/{r}/collaborators/{u}/permission`)
   and passed to `parseCommand` (G1), so an org member with write access counts as a maintainer.
3. `/bounty` → `createBounty`; `/claim /unclaim /pay /hold /reject /cancel` → `transition()` (F2).
   The bounty is saved with a compare-and-set on its status (`BountyRepo.update`, in
   `apps/server/src/bounties/repo.ts`, shared with G4) and the event goes on `eventBus`.
4. The status comment (G2) is edited in place: by `statusCommentId`, else found by its marker in a
   bot comment, else posted. The issue keeps exactly one `bounty: <status>` label plus `💰 <amount> FCFA`.
5. Parser and transition errors get a short `@user …` reply quoting the error. `/bounty` and `/claim`
   on a closed issue, commands on a PR, and `/extend` / `/criteria` (not wired yet) also get a reply.

Env: `WEB_BASE_URL` (links in the comment), `BOT_LANG` (`en`|`fr`), optional `GITHUB_BOT_LOGIN`.
All GitHub writes go through `GithubWriter` (`FakeGithubWriter` in tests).

## 7. Verification check run (A2)

`apps/server/src/ai/check-run/` registers on `githubDispatcher` for `pull_request.opened` /
`synchronize` / `reopened`. If the PR closes (`Fixes #n`) an issue whose bounty is
`funded`/`claimed`/`submitted`/`verified` (looked up in G4's `BountyRepo`):

1. creates a check run **"BitBounty verification"** `in_progress` on the head sha (inside the webhook);
2. after answering the webhook (GitHub's 10 s limit), fetches the PR diff (`application/vnd.github.diff`)
   and CI (check runs + statuses, our own check excluded) and calls A1's `verify()`;
3. completes it: `pass` → success, `fail` → failure, `unsure` → neutral, with a summary listing each
   criterion and its evidence, and saying it is advice: a human maintainer decides;
4. publishes `verify.done` on the shared `eventBus`.

A newer push makes older runs finish as `skipped` ("Superseded") with no verdict and no `verify.done`.
Verifier down, diff unreadable (GitHub 406 on huge PRs) or any crash → `neutral`, never a false failure.
The verifier is Claude when `ANTHROPIC_API_KEY` is set, else A1's offline heuristic fake (the check says so).
Disabled when the GitHub App env is missing. Demo switch until F3 stores bounties:
`CHECK_RUN_DEMO_LOOKUP=issue` treats any issue a PR closes as funded, criteria from its "Done when".

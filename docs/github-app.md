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
| Webhook URL | `https://smee.io/gk8M8VuUD4ZMaO7A` → `WEBHOOK_PROXY_URL` (switch to `https://<railway-host>/webhooks/github` once deployed) |
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
   → Save. Put the same value in your local `.env` (and Railway) as `GITHUB_WEBHOOK_SECRET`.
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
cd apps/server && npm install   # or pnpm install at the root once F1 is merged

# terminal 1: the receiver (in-memory store, logs each event)
npm run dev:webhook             # → http://localhost:3001/webhooks/github

# terminal 2: forward smee → local
npx smee-client --url https://smee.io/gk8M8VuUD4ZMaO7A --target http://localhost:3001/webhooks/github
```

Once F1/F3 are merged, the main server mounts `githubWebhookRoutes(...)` with `DrizzleEventStore`
and rows land in Postgres; point `--target` at that server's port instead.

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
import { DrizzleEventStore } from "./github/drizzle-event-store.js";

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

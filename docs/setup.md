# Setup

How to run BitBounty on your machine, from nothing to a bounty that reacts to GitHub comments. Each step past the first works on its own: without keys, the web runs on demo data and the server on in-memory stores.

## Requirements
- Node 22 (`.nvmrc`)
- pnpm 10 through corepack: `corepack enable` (the exact version is pinned in `package.json`). If `pnpm` isn't on your path, prefix commands with `corepack`, e.g. `corepack pnpm install`.
- Docker (for Postgres), or any Postgres 16

## Layout
```
apps/web          Next.js 15 (App Router) + Tailwind 4: every page
apps/server       Node + Hono: webhooks, commands, funding, settlement, payouts, /api and /v1
packages/core     the contract: bounty state machine, events, commands parser, money helpers
packages/db       Postgres schema (Drizzle), migrations, demo seed
packages/bitnob   typed Bitnob client (HMAC signing, retries)
packages/mcp      MCP server so AI agents can post bounties
```
How the parts talk: [architecture.md](architecture.md).

## 1. Run it (no keys needed)
```sh
git clone https://github.com/Djbrl/bitbounty && cd bitbounty
corepack enable
pnpm install                 # also builds @bitbounty/db, which the server imports from dist/
cp .env.example .env         # repo-root .env, read by the server and the db scripts
docker compose up -d db      # Postgres 16 on localhost:5432 (user/password postgres, db bitbounty)
pnpm db:migrate              # creates the tables (safe to run again)
pnpm db:seed                 # demo rows: 9 bounties on 3 repos (safe to run again)
pnpm dev                     # web on http://localhost:3000, server on http://localhost:8787
```
Check:
- `curl localhost:8787/health` → `{"status":"ok"}`. The server log says `[db] ...` to tell whether it uses Postgres (`DATABASE_URL` set, the `.env.example` default) or in-memory stores.
- http://localhost:3000 shows the board.

Port 5432 already taken? Run Postgres elsewhere and change `DATABASE_URL` in `.env`. No Docker at all? Empty `DATABASE_URL` in `.env`: the server then keeps everything in memory (lost on restart), and skip the two `db:` commands.

**Web on demo data or on your server.** Next.js reads its env from `apps/web/`, not the repo root. With no `apps/web/.env.local`, every page uses the built-in fixtures. To read your local server instead:
```sh
echo "NEXT_PUBLIC_API_URL=http://localhost:8787" >> apps/web/.env.local
```
Then restart `pnpm dev`. Sign in with GitHub is off until `AUTH_SECRET` is set (step 2).

| Command | What it does |
| --- | --- |
| `pnpm dev` | runs every app in watch mode |
| `pnpm test` | runs every package's tests (vitest) |
| `pnpm lint` | ESLint on the whole repo |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm build` | builds every app |
| `pnpm db:migrate` | applies the database migrations (`DATABASE_URL`) |
| `pnpm db:seed` | replaces the demo rows (9 bounties on 3 repos) and leaves everything else; safe to run again |
| `pnpm db:generate` | writes a new migration after a schema change |

Every variable is documented in [`.env.example`](../.env.example). Secrets go in `.env` / `apps/web/.env.local`, never in git.

## 2. Your own GitHub App (commands on real issues)
The bot needs a GitHub App whose private key you hold. Ours (`bitbounty-dakar`) is registered to the team, so for your own setup register a new one: [github-app.md](github-app.md) lists the permissions and events, and how to fill the secrets.

1. Create a channel on https://smee.io (GitHub can't reach `localhost`, smee relays its webhooks) and use its URL as the app's **Webhook URL**.
2. In the repo-root `.env`: `GITHUB_APP_ID`, `GITHUB_WEBHOOK_SECRET` (the value you typed in the app settings), `GITHUB_PRIVATE_KEY` (the `.pem`, one line with `\n` or base64), and `WEBHOOK_PROXY_URL` (your smee URL).
3. Forward the webhooks to the server, in a second terminal:
   ```sh
   npx smee-client --url https://smee.io/<your-channel> --target http://localhost:8787/webhooks/github
   ```
4. Install the app on a test repo, restart `pnpm dev`, and comment `/bounty 10000` on an issue: the bot answers with a status comment.

Sign in with GitHub on the web uses the same app as OAuth provider: set `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` in `apps/web/.env.local` and add `http://localhost:3000/api/auth/callback/github` to the app's callback URLs ([auth.md](auth.md)). Set `INTERNAL_API_TOKEN` to the same long random string in both env files.

To claim a bounty without paying for it while testing, set `DEV_HOOK_TOKEN` in `.env` and mark it funded with `POST /dev/fund` (see `.env.example`). Leave it empty in production.

## 3. Bitnob sandbox keys (funding and payouts)
1. Create an account on the Bitnob dashboard and a **sandbox** API app: you get a Client ID and a secret. The secret decides the environment (same Client ID for sandbox and production).
2. Bitnob only answers whitelisted IPs: add your public IP (`curl -s https://api.ipify.org`) to the API key's allowed IPs. A `403 IP address not whitelisted` means your IP changed.
3. In `.env`: `BITNOB_CLIENT_ID`, `BITNOB_CLIENT_SECRET` (leave `BITNOB_BASE_URL` empty for `https://api.bitnob.com`).
4. Check the keys and the main calls (it stops unless `whoami` says `environment=sandbox`):
   ```sh
   cd packages/bitnob && pnpm smoke
   pnpm --filter @bitbounty/server lightning:smoke -- 1000    # rates + a Lightning invoice for 1000 FCFA
   pnpm --filter @bitbounty/server ngn:smoke -- 300           # naira virtual account + simulated deposit + NGN→BTC
   ```
5. Bitnob webhooks (naira deposits, payout events) need a public URL for the server: `npx cloudflared tunnel --url http://localhost:8787` (or ngrok). In the Bitnob dashboard → Webhooks, set `https://<public-url>/webhooks/bitnob`, and put the secret you chose there in `.env` as `BITNOB_WEBHOOK_SECRET` (without it the route answers 503).

Payouts go to the developer's **Lightning Address** in sats ([architecture.md](architecture.md)): until developers can save one from the web, `PAYOUT_ACCOUNTS` in `.env` maps a GitHub login to a Lightning Address, e.g. `{"awa-dev":"awa@blink.sv"}` (Lightning payouts, B6 [#102](https://github.com/Djbrl/bitbounty/pull/102)). `MAX_PAYOUT_SATS` caps one payout (default 100000 sats). The Bitnob sandbox refuses the pay call itself (`403 FEATURE_NOT_ENABLED`, `send_lightning`), so a sandbox payout ends `payout_failed` with nothing debited; `pnpm --filter @bitbounty/server payout:smoke` shows every step up to it. `OBJECTION_WINDOW_MINUTES=0` pays right after the merge (the demo setting). Details and sandbox results: [bitnob-api.md](bitnob-api.md).

## 4. Claude (optional)
Set `ANTHROPIC_API_KEY` in `.env` to run the real PR verifier and "Price my backlog" (`claude-sonnet-5-5` by default, `VERIFIER_MODEL` / `BACKLOG_MODEL` to change it). Without it, the verifier uses an offline fake and the backlog pricer a heuristic. Try it without GitHub: `pnpm --filter @bitbounty/server verify:fixtures`, `pnpm --filter @bitbounty/server backlog <owner/repo>` ([backlog.md](backlog.md)).

## 5. Agents (optional)
Create an agent key with `pnpm --filter @bitbounty/server agent:create` and run the MCP server for Claude Code: [agents.md](agents.md).

## Database
Postgres 16 with Drizzle; schema, migrations and seed live in [`packages/db`](../packages/db/README.md) (`@bitbounty/db`).

```sh
docker compose up -d db     # Postgres on localhost:5432 (or any Postgres)
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/bitbounty   # the .env.example default
pnpm db:migrate             # creates the tables (safe to run again)
pnpm db:seed                # replaces the demo rows only (9 bounties on 3 Djbrl/* repos), safe to run again
docker compose exec db psql -U postgres -d bitbounty -c 'select status, count(*) from bounties group by 1'
```

- When `DATABASE_URL` is set the server stores webhooks in `events` (`DrizzleEventStore`, dedupe on `(source, external_id)`) and keeps bounties, claims and submissions in Postgres through `DrizzleBountyRepo` (apps/server/src/bounties/drizzle-repo.ts, shared by G3 comments, G4 PRs, G5 claim timers and A2 checks), so they survive a restart. Without it both are in memory. It logs `[db] ...` at start to say which.
- The server applies pending migrations itself at start when `DATABASE_URL` is set, so the Docker server needs no manual migrate.
- `pnpm install` builds `@bitbounty/db` (`prepare` script): the server imports it from `dist/`. After a schema change: `pnpm db:generate`, commit the new file in `packages/db/drizzle/`.
- `pnpm test` runs the DB tests on PGlite (in memory). With `DATABASE_URL` set they also run against that Postgres, in a throwaway database created and dropped by the test.

Health checks: server `GET /health` → `{"status":"ok"}`. Web `/api/health` → `{"status":"ok"}`.

## Adding a shared package (`packages/*`)
- Name it `@bitbounty/<name>` and give it a `build` script that outputs JS to `dist/`, with `main`/`exports` pointing at the built files. The server runs plain `node dist/index.js` and cannot load `.ts` from a dependency.
- The Docker build (`Dockerfile`) runs `pnpm --filter "@bitbounty/server..." build`, which builds the server's workspace dependencies first.
- If the web app imports it from TS source, add it to `transpilePackages` in `apps/web/next.config.ts`.

## Versions
- Node 22 (`engines`, `.nvmrc`). `@types/node` stays on 22 to match.
- TypeScript stays on **5.x**: TS 7 breaks Next 15 and typescript-eslint.

## Deploy
What we run: the server, Postgres and the webhook relays with **Docker Compose** on an always-on machine, and the web on **Vercel**. (`railway.json` is left from an early plan; we don't deploy to Railway.)

### Server + Postgres with Docker
One command starts everything:

```sh
cp .env.example .env    # then fill the secrets (GitHub App, Bitnob, Anthropic: see above)
docker compose up -d --build
docker compose logs tunnel | grep trycloudflare   # the public API URL
```

| Service | What it does |
|---|---|
| `db` | Postgres 16, data kept in the `pgdata` volume, exposed on `localhost:5432` |
| `server` | `apps/server` built from the `Dockerfile`, on `localhost:8787`, reads `.env` |
| `smee` | Forwards GitHub App webhooks from the smee channel to the server. The smee URL is stable, so the app settings never change. **The channel is ours (`docker-compose.yml`): change it to yours for your own app** |
| `tunnel` | Cloudflare quick tunnel: a public `https://….trycloudflare.com` URL for the web app and Bitnob webhooks, no account needed |

- **Check:** `curl <tunnel-url>/health` → `{"status":"ok"}`; an unsigned `POST <tunnel-url>/webhooks/github` → 401.
- **After a code change:** `docker compose up -d --build server`.
- **Venue / restrictive Wi-Fi:** the tunnel uses `--protocol http2` (TCP 443) because some networks block QUIC (UDP), which silently kills the default quick tunnel.
- **The tunnel URL changes when the `tunnel` container restarts** (reboot, Docker restart). Then update `NEXT_PUBLIC_API_URL` on Vercel and redeploy the web, and the webhook URL in the Bitnob dashboard.
- **Keep it up:** Docker Desktop → Settings → "Start Docker Desktop when you sign in"; keep the machine awake (`caffeinate -dims &` on a Mac) and plugged in. All services restart on their own (`restart: unless-stopped`).
- **Database from your machine:** `DATABASE_URL=postgres://postgres:postgres@localhost:5432/bitbounty` for `pnpm db:migrate` / `db:seed`; `docker compose exec db psql -U postgres -d bitbounty` for a shell. The `server` container migrates at start. Rebuild only the server (`docker compose up -d --build server`): never `docker compose down -v` (deletes `pgdata`) and avoid restarting `tunnel` (its URL changes).

### Web on Vercel
1. **Add New Project** → import the repo.
2. **Root Directory**: `apps/web` (framework detected: Next.js). Keep the default install and build commands.
3. Set `NEXT_PUBLIC_API_URL` (or `BITBOUNTY_API_URL`) to the server URL: every page then reads the real server (unset = fixtures, see [api.md](api.md)). For sign-in with GitHub also set `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` (see [auth.md](auth.md)), and add `https://<your-domain>/api/auth/callback/github` to the GitHub App's callback URLs.
4. **Before deploying, set `INTERNAL_API_TOKEN` to the same value on Vercel and on the server** (the server's `.env`, then `docker compose up -d --build server`). Use one long random string, for example `openssl rand -hex 32`. The web sends it with the signed-in GitHub login, and the server trusts that login only when the token matches. Otherwise, as soon as `NEXT_PUBLIC_API_URL` is set:
   - **Missing on Vercel, or a different value:** the server answers 401, so `/dashboard` and `/me` show "Session expirée ou accès refusé" for everyone, even when signed in.
   - **Missing on the server:** `/me` is always 401, and `/dashboard` is no longer per maintainer: anyone who opens it sees every maintainer's bounties.

   After changing it on Vercel, redeploy the web (env changes only apply to new deployments).
5. Deploy, then open `/api/health` → `{"status":"ok"}`.

Every variable lives in `.env.example`. A task that adds one updates that file in the same PR.

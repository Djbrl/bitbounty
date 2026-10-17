# Setup

## Requirements
- Node 22+ (`.nvmrc`)
- pnpm 10 (`corepack enable`, the version is pinned in `package.json`)

## Layout
```
apps/web        Next.js 15 (App Router) + Tailwind 4
apps/server     Node + Hono
packages/*      shared packages (core, db, bitnob, mcp), added by later tasks
```

## Run locally
```sh
pnpm install
cp .env.example .env
pnpm dev          # web on http://localhost:3000, server on http://localhost:8787
```

| Command | What it does |
| --- | --- |
| `pnpm dev` | runs every app in watch mode |
| `pnpm test` | runs every package's tests (vitest) |
| `pnpm lint` | ESLint on the whole repo |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm build` | builds every app |
| `pnpm db:migrate` | applies the database migrations (`DATABASE_URL`) |
| `pnpm db:seed` | empties the database and fills it with demo data (one bounty per status) |
| `pnpm db:generate` | writes a new migration after a schema change |

Local database: `docker compose up -d db` (or any Postgres) with the default `DATABASE_URL` from `.env.example`. Then `pnpm db:migrate && pnpm db:seed`. Details in [packages/db/README.md](../packages/db/README.md).

Health checks: server `GET /` returns JSON containing `"message":"hello"`, `GET /health` → `{"status":"ok"}`. Web `/` shows "hello", `/api/health` → `{"status":"ok"}`.

## Adding a shared package (`packages/*`)
- Name it `@bitbounty/<name>` and give it a `build` script that outputs JS to `dist/`, with `main`/`exports` pointing at the built files. The server runs plain `node dist/index.js` and cannot load `.ts` from a dependency.
- The Railway build runs `pnpm --filter "@bitbounty/server..." build`, which builds the server's workspace dependencies first.
- If the web app imports it from TS source, add it to `transpilePackages` in `apps/web/next.config.ts`.

## Versions
- Node 22 (`engines`, `.nvmrc`). `@types/node` stays on 22 to match.
- TypeScript stays on **5.x**: TS 7 breaks Next 15 and typescript-eslint.

## Deploy

### Server + Postgres on Railway (alternative, paid)
1. New project → **Deploy from GitHub repo** → `Djbrl/bitbounty`. Railway installs with pnpm and reads `railway.json` at the root (build, start command, `/health` check, redeploy only when server files change). That file applies to every Railway service built from this repo.
2. Add a **Postgres** service, then in the server service set `DATABASE_URL` to `${{Postgres.DATABASE_URL}}`.
3. Settings → Networking → **Generate domain**. `GET https://<domain>/` must answer `hello`.

### Server + Postgres with Docker (what we use: Railway is paid)
The server runs on an always-on Mac with Docker Desktop. One command starts everything:

```sh
cp .env.example .env    # then fill the GitHub App secrets (see docs/github-app.md)
docker compose up -d --build
docker compose logs tunnel | grep trycloudflare   # the public API URL
```

| Service | What it does |
|---|---|
| `db` | Postgres 16, data kept in the `pgdata` volume, exposed on `localhost:5432` |
| `server` | `apps/server` built from the `Dockerfile`, on `localhost:8787`, reads `.env` |
| `smee` | Forwards GitHub App webhooks from `https://smee.io/gk8M8VuUD4ZMaO7A` to the server. The smee URL is stable, so the app settings never change |
| `tunnel` | Cloudflare quick tunnel: a public `https://….trycloudflare.com` URL for the web app and Bitnob webhooks, no account needed |

- **Check:** `curl <tunnel-url>/health` → `{"status":"ok"}`; an unsigned `POST <tunnel-url>/webhooks/github` → 401.
- **After a code change:** `docker compose up -d --build server`.
- **The tunnel URL changes when the `tunnel` container restarts** (Mac reboot, Docker restart). Then update `NEXT_PUBLIC_API_URL` on Vercel and redeploy the web.
- **Keep it up:** Docker Desktop → Settings → "Start Docker Desktop when you sign in"; keep the Mac awake (`caffeinate -dims &`) and plugged in. All services restart on their own (`restart: unless-stopped`).
- **Database from your machine:** `DATABASE_URL=postgres://postgres:postgres@localhost:5432/bitbounty` (for `pnpm db:migrate`; never `db:seed` on the shared database, it empties every table).

### Web on Vercel
1. **Add New Project** → import `Djbrl/bitbounty`.
2. **Root Directory**: `apps/web` (framework detected: Next.js). Keep the default install and build commands.
3. Set `NEXT_PUBLIC_API_URL` to the Railway server URL. For sign-in with GitHub also set `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` (see [auth.md](auth.md)).
4. Deploy. The home page must show "hello".

Every variable lives in `.env.example`. A task that adds one updates that file in the same PR.

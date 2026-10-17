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

Health checks: server `GET /` returns JSON containing `"message":"hello"`, `GET /health` → `{"status":"ok"}`. Web `/` shows "hello", `/api/health` → `{"status":"ok"}`.

## Adding a shared package (`packages/*`)
- Name it `@bitbounty/<name>` and give it a `build` script that outputs JS to `dist/`, with `main`/`exports` pointing at the built files. The server runs plain `node dist/index.js` and cannot load `.ts` from a dependency.
- The Railway build runs `pnpm --filter "@bitbounty/server..." build`, which builds the server's workspace dependencies first.
- If the web app imports it from TS source, add it to `transpilePackages` in `apps/web/next.config.ts`.

## Versions
- Node 22 (`engines`, `.nvmrc`). `@types/node` stays on 22 to match.
- TypeScript stays on **5.x**: TS 7 breaks Next 15 and typescript-eslint.

## Deploy

### Server + Postgres on Railway
1. New project → **Deploy from GitHub repo** → `Djbrl/bitbounty`. Railway installs with pnpm and reads `railway.json` at the root (build, start command, `/health` check, redeploy only when server files change). That file applies to every Railway service built from this repo.
2. Add a **Postgres** service, then in the server service set `DATABASE_URL` to `${{Postgres.DATABASE_URL}}`.
3. Settings → Networking → **Generate domain**. `GET https://<domain>/` must answer `hello`.

### Web on Vercel
1. **Add New Project** → import `Djbrl/bitbounty`.
2. **Root Directory**: `apps/web` (framework detected: Next.js). Keep the default install and build commands.
3. Set `NEXT_PUBLIC_API_URL` to the Railway server URL. For sign-in with GitHub also set `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` (see [auth.md](auth.md)).
4. Deploy. The home page must show "hello".

Every variable lives in `.env.example`. A task that adds one updates that file in the same PR.

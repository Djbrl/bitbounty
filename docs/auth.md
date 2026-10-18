# Sign in with GitHub

The web app signs people in with GitHub through **Auth.js v5** (`next-auth@5` beta), using the
existing GitHub App **BitBounty Dakar** as the OAuth provider (GitHub Apps support user OAuth, so
there is no separate OAuth App). The session is a signed, encrypted JWT cookie: no database needed.

## What the session knows

`session.user` carries the GitHub identity, mapped to the `User` type of `packages/core`:

| Session field | From GitHub `GET /user` | `User` field |
|---|---|---|
| `githubId` | `id` | `githubId` |
| `login` | `login` | `login` |
| `avatarUrl` | `avatar_url` (https only, else `null`) | `avatarUrl` |

Read it with the helpers, never by poking at the raw session:

```ts
import { auth } from "@/auth";
import { sessionToUser } from "@/lib/auth/session-user";

const user = sessionToUser(await auth()); // { githubId, login, avatarUrl } | null
```

In middleware / route handlers wrapped with `auth(...)`, use `sessionToUser(req.auth)`.
The server trusts this login only when the web also sends `INTERNAL_API_TOKEN` ([api.md](api.md)).

## Files

| File | Role |
|---|---|
| `apps/web/auth.ts` | Auth.js config: GitHub provider, JWT session (7 days), callbacks that store / expose the fields above |
| `apps/web/app/api/auth/[...nextauth]/route.ts` | Auth.js endpoints (the static `auth` segment wins over the `app/api/[...path]` catch-all) |
| `apps/web/middleware.ts` | Redirects signed-out visitors of `/dashboard`, `/me`, `/welcome` and `/app` (and sub-paths) to `/signin?callbackUrl=...`. Everything else is public |
| `apps/web/app/signin/page.tsx` | Sign-in page; also shows Auth.js errors (`?error=OAuthCallbackError` when the user refuses on GitHub) |
| `apps/web/components/auth/` | `SignInButton`, `SignOutButton`, `UserMenu` (server components, no client JS). Drop `<UserMenu />` in any header |
| `apps/web/lib/auth/session-user.ts` | Pure mapping profile / token / session → `{ githubId, login, avatarUrl }` (tested) |
| `apps/web/lib/auth/paths.ts` | Protected paths, `authEnabled()`, safe `callbackUrl`, error messages (tested) |

## Auth off by default (local dev on fixtures)

If `AUTH_SECRET` is **unset or empty**, auth is off: middleware lets every page through,
`UserMenu` renders nothing and `/signin` says sign-in is off. So `pnpm dev` on fixtures needs no
GitHub setup. Set `AUTH_SECRET` (plus the two GitHub values) to switch it on.

## Environment

Next.js reads env files from `apps/web/`, not the repo root: put these in `apps/web/.env.local`
(git-ignored) for local dev, and in Vercel → Project → Settings → Environment Variables.

| Variable | Value |
|---|---|
| `AUTH_SECRET` | random, generate with `npx auth secret` (or `openssl rand -base64 33`). Turns auth on |
| `AUTH_GITHUB_ID` | `Iv23liCkNNOVL2DflyZ1` (public Client ID of the GitHub App) |
| `AUTH_GITHUB_SECRET` | a client secret of the GitHub App (see below), never committed |
| `AUTH_TRUST_HOST` | `true` only when running `next start` yourself (not needed on Vercel or in `next dev`) |

## One-time setup (GitHub App owner)

1. **Client secret.** https://github.com/settings/apps/bitbounty-dakar → *Client secrets* →
   *Generate a new client secret*. Copy it once into `AUTH_GITHUB_SECRET` (local `.env.local` and Vercel).
2. **Callback URLs.** Same page → *Callback URL*: `http://localhost:3000/api/auth/callback/github`
   and `https://bitbounty-app.vercel.app/api/auth/callback/github` (GitHub Apps accept several).
   GitHub refuses any redirect that is not listed, so a dev server on another port needs its own entry.
3. **Vercel env.** Set `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` for Production (and Preview
   if wanted; previews have other URLs, so add their callback too or sign-in fails there), then redeploy.

## Test it

Automated: `pnpm --filter @bitbounty/web test` covers the session → `User` mapping, path matching,
`callbackUrl` sanitising, and the middleware (no-op without `AUTH_SECRET`, redirect when signed out,
pass-through with a valid session cookie, redirect again once the cookie has expired).

Manual (after the setup above):
1. `pnpm --filter @bitbounty/web dev`, open http://localhost:3000/dashboard → redirected to `/signin`.
2. *Sign in with GitHub* → authorize on GitHub → back on `/dashboard`. `/signin` (or any `<UserMenu />`)
   shows your avatar and `@login`. `GET /api/auth/session` returns `githubId`, `login`, `avatarUrl`.
3. *Sign out* → back on `/`; `/dashboard` redirects to `/signin` again.
4. Refuse: on GitHub's authorize screen click *Cancel* → `/signin` shows "GitHub sign-in was cancelled or refused".
5. Expiry: delete the `authjs.session-token` cookie (or wait 7 days) → `/dashboard` redirects to `/signin`.

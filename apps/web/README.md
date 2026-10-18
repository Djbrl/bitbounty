# @bitbounty/web

Next.js 15 (App Router) + Tailwind 4, deployed on Vercel at https://bitbounty-app.vercel.app.

| Route | Page |
| --- | --- |
| `/` | landing |
| `/explore` | public board of funded bounties |
| `/welcome` | onboarding after sign-in (role, stack, Lightning Address) |
| `/app/hunt` | developer home |
| `/app/maintain` (+ `/repos`, `/payouts`, `/stats`) | maintainer home: review queue with Claude's verdicts, Pay / Hold, "Price my backlog", repos, payouts, agent budgets |
| `/dashboard` | maintainer dashboard (first version) with "Price my backlog" |
| `/me` | the developer saves their Lightning Address |
| `/b/[id]` | bounty page: criteria, claim, PR, verdict, timeline |
| `/pay/[id]` | payment page: Lightning invoice (QR), polled until paid |
| `/r/[id]` | payout receipt |
| `/u/[login]` | developer's proof-of-work profile |
| `/live` | live screen of bounty events (SSE) |
| `/dev/ui` | design system catalogue ([components/README.md](components/README.md)) |

## Data
With `BITBOUNTY_API_URL` or `NEXT_PUBLIC_API_URL` set, pages read the server; without them, they use the fixtures in [`fixtures/`](../../fixtures/README.md). Details: [docs/api.md](../../docs/api.md).

## Env (`apps/web/.env.local`, or Vercel settings)
| Variable | |
| --- | --- |
| `NEXT_PUBLIC_API_URL` / `BITBOUNTY_API_URL` | server origin; unset = fixtures |
| `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` | sign in with GitHub; auth is off while `AUTH_SECRET` is empty ([docs/auth.md](../../docs/auth.md)) |
| `INTERNAL_API_TOKEN` | same value as on the server; lets the server trust the signed-in login |

## Run and test
```sh
pnpm --filter @bitbounty/web dev     # http://localhost:3000
pnpm --filter @bitbounty/web test
pnpm --filter @bitbounty/web build
```
On Vercel, set the project's Root Directory to `apps/web` ([docs/setup.md](../../docs/setup.md#web-on-vercel)).

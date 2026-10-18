# @bitbounty/server

Node 22 + Hono. Receives GitHub and Bitnob webhooks, runs the bot's commands, funds bounties, runs settlement after the merge, pays out over Lightning, and serves the web API (`/api`) and the agent API (`/v1`). Wiring: `src/app.ts`.

| Folder | What |
| --- | --- |
| `src/github/` | `/webhooks/github` (signature check, dedupe), comment commands, status comment, claims and their timers, PR detection ([docs/github-app.md](../../docs/github-app.md)) |
| `src/ai/` | Claude PR verifier and the "BitBounty verification" check run; "Price my backlog" ([docs/backlog.md](../../docs/backlog.md)) |
| `src/funding/` | Lightning funding (wired) and naira funding (sandbox only, not wired): [README](src/funding/README.md) |
| `src/settlement/` | after the merge: verdict, objection window, payout start, status comment updates |
| `src/payouts/` | Lightning payouts to a Lightning Address: [README](src/payouts/README.md) |
| `src/bitnob/` | `/webhooks/bitnob` (HMAC-SHA512, dedupe on `event_id`) |
| `src/api/` | read API for the web, `/api/maintain` pay / hold ([docs/api.md](../../docs/api.md)) |
| `src/agents/` | `/v1` agent API, `bb_` keys and budgets ([docs/agents.md](../../docs/agents.md)) |
| `src/onboarding/` | `/welcome` answers and the developer's Lightning Address: [README](src/onboarding/README.md) |
| `src/e2e/` | end-to-end and failure-path scripts: [README](src/e2e/README.md) |
| `src/dev/` | sandbox proxy for the team, mounted only with `DEV_PROXY_TOKEN` |

Without `DATABASE_URL` the stores are in memory. Without the GitHub App, Bitnob or Anthropic keys, the matching features are off or use offline fakes. Every variable is in [`.env.example`](../../.env.example).

## Run and test
```sh
pnpm --filter @bitbounty/server dev        # http://localhost:8787, reads the repo-root .env
curl localhost:8787/health                 # {"status":"ok"}
pnpm --filter @bitbounty/server test
pnpm --filter @bitbounty/server e2e        # the whole story on fakes
```
Other scripts (`package.json`): `lightning:smoke`, `ngn:smoke`, `payout:smoke` (Bitnob sandbox, refuse to run on production keys), `live-pay` (one real payout on production, run by a human), `verify:fixtures`, `backlog`, `agent:create`, `agent:demo`, `demo:failures`.

The Docker image (`Dockerfile` at the repo root) runs `node dist/index.js` as the `node` user and applies migrations at start.

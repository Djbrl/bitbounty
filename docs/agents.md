# Agents as funders (A4)

An AI agent can put a bounty on a GitHub issue when it hits work that needs a human (Wolof, a test on a real phone in Dakar, a real-world check). It uses a `bb_...` key and stays inside the budget its **human owner** set. The bounty starts **unfunded**: the owner pays it from the returned `fund_url`. The merge is still done by a human maintainer.

Code: server `apps/server/src/agents/` (the `/v1` API), MCP server `packages/mcp/`. Stage demo and its scripted fallback (`agent:demo`): [demo/agent-demo.md](demo/agent-demo.md).

## 1. Create an agent key (owner, once)
```sh
pnpm --filter @bitbounty/server agent:create --name demo-agent --owner Djbrl --budget 30000 --max 20000 --repos galsen-oss/wolof-i18n
```
It prints the key **once** (give it to the agent) and a JSON entry. Add the entry to `BITBOUNTY_AGENTS` in the server's `.env`, which is a JSON array, then restart the server:
```
BITBOUNTY_AGENTS=[{"id":"…","name":"demo-agent","ownerLogin":"Djbrl","keyHash":"…","monthlyBudgetXof":30000,"perTaskMaxXof":20000,"allowedRepos":["galsen-oss/wolof-i18n"],"revoked":false}]
```
- The CLI refuses a `--budget` below 1000 FCFA (the smallest bounty) and a `--max` above `--budget`.
- Only the key's SHA-256 is stored. A lost key can't be recovered: create a new one.
- **Revoke**: set `"revoked": true` (or remove the entry) and restart.
- An invalid entry stops the server at startup with a clear message, so a typo can't silently open or close access.

## 2. Plug it into Claude Code (MCP)
```sh
pnpm --filter @bitbounty/mcp build
claude mcp add bitbounty -e BITBOUNTY_API_URL=http://localhost:8787 -e BITBOUNTY_AGENT_KEY=bb_... -- node /path/to/bitbounty/packages/mcp/dist/index.js
```
`BITBOUNTY_API_URL` must be `https://` (e.g. the public tunnel URL). Plain `http://` is only accepted for `localhost`, `127.0.0.1` or `[::1]`, because the agent key is sent as a bearer token; any other URL stops the MCP server at startup with a clear message.

Tools: `post_bounty`, `get_bounty`, `cancel_bounty`, `get_budget`. On a refusal the tool returns an error with a hint (over budget, repo not allowed…), so the agent can adapt.

## 3. Or call the API directly
`Authorization: Bearer bb_...` on every call.

| Call | Body / answer |
| --- | --- |
| `POST /v1/bounties` | `{repo, issue_number, amount_xof, criteria[1..6], issue_title?}` → `201 {bounty, warnings}` |
| `GET /v1/bounties/:id` | the bounty (only the agent's own; others → 404) |
| `DELETE /v1/bounties/:id` | `{reason?}` → cancels until a PR is submitted (unfunded → `cancelled`, funded/claimed → marked `refunded`; the money goes back to the owner by hand for now). An active claim is released and the developer unassigned |
| `GET /v1/budget` | monthly budget, committed this month, remaining, per-task max, allowed repos |

`bounty` = `{id, repo, issue_number, issue_title, amount_xof, status, criteria, fund_url, created_at}`.

## Rules (checked by the server, whatever the agent sends)
- **Key**: missing, wrong or revoked → `401 unauthorized` (same answer for all three).
- **Repo**: must be in `allowedRepos` (case-insensitive) → else `403 repo_not_allowed`.
- **Per task**: `amount_xof` ≤ `perTaskMaxXof` → else `403 over_task_max`.
- **Budget**: bounties posted this UTC month and not cancelled/refunded count against `monthlyBudgetXof` → else `403 over_budget`. Parallel requests from one agent are serialized, so they can't overspend together. Budgets reset on the 1st of the month.
- **One bounty per issue**, shared with `/bounty` comments → `409 issue_has_bounty`.
- Input: whole FCFA, at least 1 000, 1–6 criteria of ≤ 300 characters, `owner/name` repo, `issue_number` from 1 to 2 147 483 647 (the database's integer limit) → else `400 invalid_input`.
- The issue number isn't checked against GitHub yet: the agent should only post on issues that exist (follow-up).
- Creation goes through `createBounty()` (event `bounty.created`), cancellation through `transition()` (event `bounty.cancelled`, actor `agent:<id>`). When the GitHub App is configured, the bot posts its status comment on the issue like for `/bounty`. If GitHub is down, the bounty is still created and the answer carries a warning.

## Limits (hackathon version)
- **One server instance**: the budget lock lives in the process. Two instances on the same database could overspend together (fix later with a Postgres advisory lock).
- Agents come from `BITBOUNTY_AGENTS`, not from the `agents` table of `packages/db` (kept for later). The budget is computed from `bounties` (Postgres when `DATABASE_URL` is set, otherwise in memory), so it survives restarts with a database.
- Refunds are a status: no money moves automatically yet.

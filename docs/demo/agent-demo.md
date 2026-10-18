# Agent demo: Claude Code funds a bounty on its own (A5)

Demo step 5. Claude Code, working in the demo repo [`Djbrl/bitbounty-demo`](https://github.com/Djbrl/bitbounty-demo), hits a task it can't do well alone: the **Wolof translation (issue 2)** needs a native speaker. Through the BitBounty MCP server it puts a 15 000 FCFA bounty on the issue, inside the budget its human owner set. Then it asks for more than is left and the server refuses.

Nothing is paid by the agent: the bounty starts **unfunded**, and the human owner pays it in sats over Lightning from the fund link. Agent API and MCP server: [docs/agents.md](../agents.md).

- **Issue 2 is reserved for the agent.** Don't put `/bounty` on it beforehand ([demo-repo.md](demo-repo.md) says so too): an issue gets one bounty, ever (even a cancelled one keeps it), so a bounty already there makes the agent's call fail with `issue_has_bounty`.
- **Issue 6** (no bounty) is the one the agent is refused on.
- The key: **20 000 FCFA a month, 15 000 FCFA max per task, only `Djbrl/bitbounty-demo`**. After the 15 000 FCFA bounty, 5 000 are left, so the 10 000 FCFA ask is refused by the budget.

## 1. Set up (human, once, before the demo)

### 1a. Create the agent key on the server
On the Mac that runs the Docker stack, in the bitbounty checkout:
```sh
corepack pnpm --filter @bitbounty/server agent:create --name claude-demo --owner Djbrl --budget 20000 --max 15000 --repos Djbrl/bitbounty-demo
```
It prints the key **once** (`bb_...`, keep it in your password manager) and a JSON entry. Put the entry in the `BITBOUNTY_AGENTS` array of the server's `.env` (keep any entries already there), then recreate the server so it reads the new `.env`:
```sh
docker compose up -d server     # restarts only the server: the tunnel URL doesn't change
docker compose logs server | grep agents   # "[agents] 1 agent key(s) loaded from BITBOUNTY_AGENTS"
```

### 1b. The public API URL
The same URL the web uses: `NEXT_PUBLIC_API_URL` on Vercel, which is the tunnel URL (`docker compose logs tunnel | grep trycloudflare`, see [setup.md](../setup.md)). It changes when the tunnel container restarts, so read it on the day. Check the key against it (prints the budget, spends nothing):
```sh
export BITBOUNTY_API_URL=https://<the tunnel>.trycloudflare.com
export BITBOUNTY_AGENT_KEY=bb_...        # from 1a, typed by you, never committed
curl -s "$BITBOUNTY_API_URL/v1/budget" -H "authorization: Bearer $BITBOUNTY_AGENT_KEY"
# {"agent":"claude-demo","owner":"Djbrl","monthly_budget_xof":20000,"committed_this_month_xof":0,"remaining_xof":20000,...}
```

### 1c. Plug the MCP server into Claude Code
Build it once, then register it, from the laptop used on stage:
```sh
corepack pnpm --filter @bitbounty/mcp build
claude mcp add bitbounty -e BITBOUNTY_API_URL="$BITBOUNTY_API_URL" -e BITBOUNTY_AGENT_KEY="$BITBOUNTY_AGENT_KEY" -- node "$PWD/packages/mcp/dist/index.js"
```
Or, to keep the key out of Claude Code's config, put this `.mcp.json` at the root of your clone of `Djbrl/bitbounty-demo` (don't commit it to the repo: it holds a path to your machine). Claude Code expands `${...}` from the environment it was started in, so export the two variables of 1b first:
```json
{
  "mcpServers": {
    "bitbounty": {
      "command": "node",
      "args": ["/absolute/path/to/bitbounty/packages/mcp/dist/index.js"],
      "env": {
        "BITBOUNTY_API_URL": "${BITBOUNTY_API_URL}",
        "BITBOUNTY_AGENT_KEY": "${BITBOUNTY_AGENT_KEY}"
      }
    }
  }
}
```
In Claude Code, `/mcp` must list `bitbounty` as connected with 4 tools. Allow its tools for the session (or answer "yes" on stage).

### 1d. Rehearse
- **Without touching the live server** (any time, as often as needed): `corepack pnpm --filter @bitbounty/server agent:demo` plays the whole scenario against a throw-away local server (section 3). Every run starts from scratch.
- **With Claude Code, locally**: run the server with `pnpm dev` and a key of your own in your local `.env` (1a), point 1c at `http://localhost:8787`, and play section 2. To run it again from scratch, restart `pnpm dev` (no `DATABASE_URL`: the bounties live in memory).
- **On the live server**, issue 2 can only be funded once. Rehearse there on another issue of a scratch repo, not on the demo repo.

## 2. On stage (≤ 45 s)

Claude Code is open in the clone of `Djbrl/bitbounty-demo`, the issue 2 page is open in a browser tab, the board in another.

| Time | Who | What |
| --- | --- | --- |
| 0 s | presenter | Types the prompt below into Claude Code |
| ~5 s | Claude Code | Calls `get_budget`: 20 000 FCFA left, max 15 000 per task, repo allowed |
| ~10 s | Claude Code | Calls `post_bounty` on issue 2: 15 000 FCFA, the 5 criteria of the issue. Answers with the bounty (`unfunded`) and the fund link |
| ~15 s | presenter | Switches to the issue 2 tab and reloads: the bot's status comment "15 000 FCFA · Waiting for funding" with the criteria and **Fund this bounty →** |
| ~25 s | presenter | Types the second prompt |
| ~30 s | Claude Code | Calls `post_bounty` on issue 6 for 10 000 FCFA: **refused**, `over_budget`, 5 000 left. Claude says so and asks the owner instead of retrying |
| ~40 s | presenter | "The agent decides, the owner pays." Clicks **Fund this bounty →**: the Lightning invoice (funding is the next demo step, by the human) |

The prompt (paste it as is):
> Issue #2 of this repo asks for a Wolof translation of the messages, approved by a native Wolof speaker. You can't do that well yourself. Use BitBounty to put a 15 000 FCFA bounty on Djbrl/bitbounty-demo issue #2, with the issue's "Done when" list as the criteria, so a developer in Dakar does it. Check the budget first, then give me the fund link.

The refusal beat:
> Also put a 10 000 FCFA bounty on issue #6 (formatXofShort).

What Claude Code answers (wording varies): the bounty id, status `unfunded`, the fund link `https://bitbounty-app.vercel.app/pay/<id>`; then for issue 6, `post_bounty failed (HTTP 403): over_budget … above the 5000 FCFA left in this month's budget` and the hint to lower the amount or ask the owner.

### What shows where
- **GitHub, issue 2**: the bot's status comment (needs the GitHub App installed on the repo, [demo-repo.md](demo-repo.md)): amount, "Waiting for funding", the 5 criteria as checkboxes, the fund link. Nothing on issue 6.
- **Web**: `/pay/<id>` (the fund link) shows the amount and the Lightning invoice to pay; `/b/<id>` the bounty page. The board lists funded bounties, so the agent's bounty appears there once the owner pays it.
- **Server**: `docker compose logs server` shows nothing special; the bounty is in Postgres with `funder_kind = agent`.

### If something goes wrong on stage
| Symptom | Cause | Fix |
| --- | --- | --- |
| `issue_has_bounty` | issue 2 already had a bounty | Say "already funded" and move on, or use the scripted fallback (section 3) |
| `unauthorized` | wrong key, or the server wasn't recreated after editing `.env` | `docker compose up -d server`, check with the `curl` of 1b |
| `network_error … BITBOUNTY_API_URL` | tunnel URL changed, or the network blipped | Read the new URL (1b), redo 1c. A blip during `post_bounty` is safe to retry: the server keeps one bounty per issue, so a retry can't create a second one (it answers `issue_has_bounty` if the first one went through) |
| No comment on GitHub | GitHub App not installed on the repo, or GitHub down | The bounty is still created (the answer carries a warning). Show `/b/<id>` instead |
| Claude Code not available | | Section 3 |

## 3. Scripted fallback (no Claude Code)
The same tool calls, in the same order, through the same MCP server (packages/mcp started over stdio, like Claude Code does), printing each step:
```sh
corepack pnpm --filter @bitbounty/server agent:demo
```
Without `--api` it starts a **throw-away local server** (the real `/v1` routes in memory, a fresh demo key with the limits above, a fake GitHub that prints the comment the bot would post). Nothing leaves the machine and nothing is paid. Run it as many times as you like: each run starts from scratch.

Against a real server (the key from the environment, never on the command line):
```sh
BITBOUNTY_AGENT_KEY=bb_... corepack pnpm --filter @bitbounty/server agent:demo -- --api "$BITBOUNTY_API_URL"
```
On the live server this creates a real (unfunded) bounty on issue 2 and the bot comments on GitHub, exactly like Claude Code would. Options: `--issue <n>` (default 2), `--amount <FCFA>` (default 15000), `--refuse-issue <n>` (default 6), `--cancel` (cancels the bounty at the end: the budget is freed, but the issue keeps its cancelled bounty).

What it prints (local run, ids shortened):
```
1. Claude Code starts the BitBounty MCP server (API http://127.0.0.1:65442)
   tools: post_bounty, get_bounty, cancel_bounty, get_budget
2. get_budget: how much may I spend?
   20 000 FCFA left of 20 000 FCFA this month, max 15 000 FCFA per task, repos: Djbrl/bitbounty-demo
3. post_bounty: 15 000 FCFA on Djbrl/bitbounty-demo#2, "it needs a native Wolof speaker"
   ✓ bounty 46fc38e1-…: unfunded, 15 000 FCFA
   fund link for the human owner (paid in sats over Lightning): http://localhost:3000/pay/46fc38e1-…
   on GitHub (Djbrl/bitbounty-demo#2), the bot posts:
     │ ### 💰 15 000 FCFA · ⏳ Waiting for funding
     │ …
4. get_bounty: still waiting for the owner to fund it
   status: unfunded
5. get_budget again
   committed 15 000 FCFA, 5 000 FCFA left
6. post_bounty: 10 000 FCFA on Djbrl/bitbounty-demo#6 (more than is left)
   ✓ refused by the server: post_bounty failed (HTTP 403): {"error":"over_budget",…}
     This month's budget is used up. Check get_budget, lower the amount, or ask your owner to raise the budget.

Done: the agent posted a bounty inside its budget and was refused above it.
```
It exits 1 and names the step when something fails (wrong key, server unreachable, issue already funded, budget already spent).

## 4. Tests
`apps/server/scripts/agent-demo.test.ts` (part of `pnpm test`) runs the scripted path over real MCP stdio against the local server: happy path, two runs in a row from scratch, a second run on the same server (refused by the budget, then `issue_has_bounty`), `--cancel`, a wrong key and an unreachable server.

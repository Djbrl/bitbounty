# @bitbounty/mcp

MCP server (stdio) that lets an AI agent such as Claude Code post and track bounties through BitBounty's `/v1` agent API, within the budget and repos its human owner allowed. The bounties it posts start unfunded: the owner pays them.

Tools: `post_bounty`, `get_bounty`, `cancel_bounty`, `get_budget`. A refusal (over budget, repo not allowed…) comes back as a tool error with a hint.

## Run
```sh
pnpm --filter @bitbounty/mcp build
claude mcp add bitbounty -e BITBOUNTY_API_URL=http://localhost:8787 -e BITBOUNTY_AGENT_KEY=bb_... -- node /path/to/bitbounty/packages/mcp/dist/index.js
```
`BITBOUNTY_API_URL` must be `https://`, except for `localhost`, `127.0.0.1` and `[::1]`, because the key is sent as a bearer token. Creating a key and the API rules: [docs/agents.md](../../docs/agents.md).

## Test
```sh
pnpm --filter @bitbounty/mcp test
```

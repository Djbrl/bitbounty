#!/usr/bin/env node
// BitBounty MCP server (stdio). Env: BITBOUNTY_API_URL (server origin), BITBOUNTY_AGENT_KEY (bb_...).
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BitbountyApi } from "./api.js";
import { createBitbountyServer } from "./server.js";

const baseUrl = process.env.BITBOUNTY_API_URL?.trim();
const agentKey = process.env.BITBOUNTY_AGENT_KEY?.trim();
if (!baseUrl || !agentKey) {
  // stdout is the MCP channel: errors go to stderr.
  console.error("bitbounty-mcp: set BITBOUNTY_API_URL and BITBOUNTY_AGENT_KEY (see docs/agents.md)");
  process.exit(1);
}

let api: BitbountyApi;
try {
  api = new BitbountyApi({ baseUrl, agentKey });
} catch (err) {
  console.error(`bitbounty-mcp: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const server = createBitbountyServer(api);
await server.connect(new StdioServerTransport());
console.error(`bitbounty-mcp: connected (API ${baseUrl})`);

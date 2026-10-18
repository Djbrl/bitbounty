import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ApiResult, BitbountyApi } from "./api.js";

/**
 * MCP tools for agents (docs/plan.md §2): an agent hits a task it can't do well alone
 * (Wolof, a test on a real phone in Dakar…) and pays a human for it, inside the budget its
 * owner set. Every rule (budget, per-task max, allowed repos) is enforced by the server;
 * these tools only forward the call and explain the answer.
 */
export function createBitbountyServer(api: BitbountyApi): McpServer {
  const server = new McpServer({ name: "bitbounty", version: "0.1.0" });

  server.registerTool(
    "post_bounty",
    {
      title: "Post a paid bounty on a GitHub issue",
      description:
        "Put a bounty (in FCFA, what the developer receives) on an existing GitHub issue so a human developer in West Africa does the task and is paid the equivalent in sats over Lightning (to their Lightning Address) when the fix is merged. " +
        "Use it for work that needs a human (local language, real device, real-world check). The bounty starts unfunded: give the returned fund_url to your human owner to pay it. " +
        "Fails if the repo isn't allowed for this agent, the amount is above the per-task max, or the monthly budget would be exceeded (check get_budget first).",
      inputSchema: {
        repo: z.string().describe('GitHub repository, "owner/name"'),
        issue_number: z.number().int().positive().max(2_147_483_647).describe("Number of the existing issue to put the bounty on"),
        amount_xof: z.number().int().min(1000).describe("What the developer receives, in whole FCFA, at least 1000 (e.g. 10000)"),
        criteria: z
          .array(z.string())
          .min(1)
          .max(6)
          .describe("1 to 6 short, testable acceptance criteria a reviewer can check in the pull request"),
        issue_title: z.string().optional().describe("Issue title, shown on the bounty page"),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => toToolResult(await api.postBounty(args), "post_bounty"),
  );

  server.registerTool(
    "get_bounty",
    {
      title: "Get one of your bounties",
      description: "Status of a bounty this agent posted (unfunded, funded, claimed, submitted, verified, paying, paid, refunded, cancelled…).",
      inputSchema: { id: z.string().describe("Bounty id returned by post_bounty") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ id }) => toToolResult(await api.getBounty(id), "get_bounty"),
  );

  server.registerTool(
    "cancel_bounty",
    {
      title: "Cancel one of your bounties",
      description:
        "Cancel a bounty this agent posted. Allowed until a developer submits a pull request (then the developer is protected). An unfunded bounty becomes cancelled; a funded one is marked refunded (the money goes back to the owner by hand for now).",
      inputSchema: {
        id: z.string().describe("Bounty id returned by post_bounty"),
        reason: z.string().optional().describe("Why, shown to the developer"),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ id, reason }) => toToolResult(await api.cancelBounty(id, reason), "cancel_bounty"),
  );

  server.registerTool(
    "get_budget",
    {
      title: "Check this agent's budget",
      description: "Monthly budget, what is already committed this month, what remains, the per-task max and the repos this agent may use.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => toToolResult(await api.getBudget(), "get_budget"),
  );

  return server;
}

const HINTS: Record<string, string> = {
  unauthorized: "The agent key is missing, wrong or revoked. Ask your human owner for a valid BITBOUNTY_AGENT_KEY.",
  over_budget: "This month's budget is used up. Check get_budget, lower the amount, or ask your owner to raise the budget.",
  over_task_max: "The amount is above this agent's per-task max. Lower it or ask your owner.",
  repo_not_allowed: "This agent may not post bounties on that repo. get_budget lists the allowed repos.",
  issue_has_bounty: "That issue already has a bounty. Pick another issue.",
  network_error: "The BitBounty server can't be reached. Check BITBOUNTY_API_URL.",
};

function toToolResult(res: ApiResult, tool: string) {
  const code = (res.body as { error?: string } | null)?.error;
  const text = res.ok
    ? JSON.stringify(res.body, null, 2)
    : `${tool} failed (HTTP ${res.status || "-"}): ${JSON.stringify(res.body)}${code && HINTS[code] ? `\n${HINTS[code]}` : ""}`;
  return { content: [{ type: "text" as const, text }], isError: !res.ok };
}

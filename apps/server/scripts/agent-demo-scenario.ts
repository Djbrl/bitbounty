// A5: the agent demo (docs/demo/agent-demo.md) played over the real MCP stdio protocol.
// The MCP server of packages/mcp runs as a child process, exactly like Claude Code starts it.
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { serve, type ServerType } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { randomUUID } from "node:crypto";
import { agentRoutes, AgentService, generateAgentKey, hashAgentKey, ListAgentSpending, StaticAgentRegistry, type Agent } from "../src/agents/index.js";
import { InMemoryBountyRepo } from "../src/bounties/repo.js";
import { FakeAssigner } from "../src/github/claims/github.js";
import { FakeGithubWriter } from "../src/github/wiring/writer.js";

export const DEMO_REPO = "Djbrl/bitbounty-demo";

/** The bounty the agent posts: issue 2 of the demo repo (docs/demo/demo-repo.md), the Wolof translation. */
export const DEMO_BOUNTY = {
  issue_number: 2,
  issue_title: "Add a Wolof (wo) translation of the messages",
  amount_xof: 15_000,
  criteria: [
    "locales/wo.json has every key of locales/en.json, and only those",
    '"wo" is in LANGUAGES and t("wo", "welcome", { name: "Awa" }) returns the Wolof message with the name filled in',
    "Placeholders ({name}, {amount}, {address}) are unchanged in every message",
    "A native Wolof speaker approves the wording in the pull request",
    "npm test passes",
  ],
};

/** The second ask, refused: issue 6 (no bounty on the demo repo), more than what is left. */
export const REFUSED_BOUNTY = {
  issue_number: 6,
  issue_title: 'Add formatXofShort(): "1,5 M FCFA" and "25 k FCFA"',
  amount_xof: 10_000,
  criteria: ["formatXofShort(amount) is exported from src/fcfa.js", "Covered by tests, npm test passes"],
};

/** Limits of the demo key: 20 000 FCFA a month, 15 000 max per task, only the demo repo. */
export const DEMO_LIMITS = { monthlyBudgetXof: 20_000, perTaskMaxXof: 15_000, allowedRepos: [DEMO_REPO] };

export interface LocalDemoServer {
  url: string;
  key: string;
  /** What the bot would post on GitHub (a fake writer: nothing leaves the machine). */
  github: FakeGithubWriter;
  repo: InMemoryBountyRepo;
  close(): Promise<void>;
}

/**
 * The real `/v1` routes and AgentService on an in-memory store, with a fresh demo key.
 * No database, no GitHub, no Bitnob: nothing is spent and every start is a clean slate.
 */
export async function startLocalDemoServer(opts: { port?: number; webBaseUrl?: string } = {}): Promise<LocalDemoServer> {
  const key = generateAgentKey();
  const agent: Agent = { id: randomUUID(), name: "demo-agent", ownerLogin: "Djbrl", keyHash: hashAgentKey(key), revoked: false, ...DEMO_LIMITS };
  const repo = new InMemoryBountyRepo();
  const github = new FakeGithubWriter();
  const assigner = new FakeAssigner();
  const service = new AgentService({
    repo,
    bus: { publish: () => undefined },
    spending: new ListAgentSpending(() => repo.all()),
    baseUrl: opts.webBaseUrl ?? "http://localhost:3000",
    github: async () => ({ writer: github, assigner }),
  });
  const app = agentRoutes(new StaticAgentRegistry([agent]), service);
  const server: ServerType = await new Promise((resolve) => {
    const s = serve({ fetch: app.fetch, port: opts.port ?? 0, hostname: "127.0.0.1" }, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    key,
    github,
    repo,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export interface DemoOptions {
  apiUrl: string;
  agentKey: string;
  repo?: string;
  issue?: number;
  amountXof?: number;
  refuseIssue?: number;
  /** Cancel the bounty at the end (frees the budget; the issue keeps its cancelled bounty). */
  cancel?: boolean;
  log?: (line: string) => void;
  /** Called after the bounty is posted (the CLI prints the GitHub comment of the local server here). */
  afterPost?: (bounty: DemoBounty) => void | Promise<void>;
}

export interface DemoBounty {
  id: string;
  status: string;
  amount_xof: number;
  fund_url: string;
  issue_number: number;
  repo: string;
}

export interface DemoResult {
  ok: boolean;
  /** The step that failed, when `ok` is false. */
  failedStep?: string;
  bounty?: DemoBounty;
  /** The refusal text returned to the agent (over budget or over the per-task max). */
  refusal?: string;
  remainingBefore?: number;
  remainingAfter?: number;
}

interface Budget {
  remaining_xof: number;
  per_task_max_xof: number;
  monthly_budget_xof: number;
  committed_this_month_xof: number;
  allowed_repos: string[];
}

const fmt = (n: number) => `${n.toLocaleString("fr-FR").replace(/[\u202f\u00a0]/g, " ")} FCFA`;

/** The tsx binary and the MCP entry point, so the demo runs without building packages/mcp. */
const TSX = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));
const MCP_ENTRY = fileURLToPath(new URL("../../../packages/mcp/src/index.ts", import.meta.url));

/**
 * Plays the stage scenario through the MCP server: check the budget, post the bounty
 * (unfunded: the human owner pays it), read it back, check the budget again, then ask for
 * more than is left and get refused. Never throws for an API failure: returns `ok: false`.
 */
export async function runAgentDemo(opts: DemoOptions): Promise<DemoResult> {
  const log = opts.log ?? ((l: string) => console.log(l));
  const repo = opts.repo ?? DEMO_REPO;
  const issue = opts.issue ?? DEMO_BOUNTY.issue_number;
  const amount = opts.amountXof ?? DEMO_BOUNTY.amount_xof;
  const refuseIssue = opts.refuseIssue ?? REFUSED_BOUNTY.issue_number;

  const transport = new StdioClientTransport({
    command: TSX,
    args: [MCP_ENTRY],
    env: { ...(process.env as Record<string, string>), BITBOUNTY_API_URL: opts.apiUrl, BITBOUNTY_AGENT_KEY: opts.agentKey },
    stderr: "ignore",
  });
  const client = new Client({ name: "bitbounty-agent-demo", version: "1.0.0" });
  const result: DemoResult = { ok: false };

  const call = async (name: string, args: Record<string, unknown>) => {
    const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { type: string; text?: string }[] };
    const text = res.content.map((c) => c.text ?? "").join("\n");
    return { isError: Boolean(res.isError), text };
  };
  const json = <T>(text: string) => JSON.parse(text) as T;
  const fail = (step: string, text: string) => {
    log(`  ✗ ${text.split("\n").join("\n    ")}`);
    result.failedStep = step;
    return result;
  };

  try {
    log(`1. Claude Code starts the BitBounty MCP server (API ${opts.apiUrl})`);
    await client.connect(transport);
    const { tools } = await client.listTools();
    log(`   tools: ${tools.map((t) => t.name).join(", ")}`);

    log("2. get_budget: how much may I spend?");
    let r = await call("get_budget", {});
    if (r.isError) return fail("get_budget", r.text);
    const before = json<Budget>(r.text);
    result.remainingBefore = before.remaining_xof;
    log(`   ${fmt(before.remaining_xof)} left of ${fmt(before.monthly_budget_xof)} this month, max ${fmt(before.per_task_max_xof)} per task, repos: ${before.allowed_repos.join(", ")}`);
    if (amount > before.remaining_xof) log(`   ! only ${fmt(before.remaining_xof)} left: the next step will be refused (fresh key or --amount)`);

    log(`3. post_bounty: ${fmt(amount)} on ${repo}#${issue}, "it needs a native Wolof speaker"`);
    r = await call("post_bounty", {
      repo,
      issue_number: issue,
      amount_xof: amount,
      criteria: issue === DEMO_BOUNTY.issue_number ? DEMO_BOUNTY.criteria : ["The issue's Done when list is met", "npm test passes"],
      ...(issue === DEMO_BOUNTY.issue_number ? { issue_title: DEMO_BOUNTY.issue_title } : {}),
    });
    if (r.isError) {
      const hint = r.text.includes("issue_has_bounty")
        ? "\n(an issue gets one bounty, ever: restart the local server, or pick another issue with --issue)"
        : "";
      return fail("post_bounty", r.text + hint);
    }
    const posted = json<{ bounty: DemoBounty; warnings: string[] }>(r.text);
    result.bounty = posted.bounty;
    log(`   ✓ bounty ${posted.bounty.id}: ${posted.bounty.status}, ${fmt(posted.bounty.amount_xof)}`);
    log(`   fund link for the human owner (paid in sats over Lightning): ${posted.bounty.fund_url}`);
    for (const w of posted.warnings) log(`   ! ${w}`);
    await opts.afterPost?.(posted.bounty);

    log("4. get_bounty: still waiting for the owner to fund it");
    r = await call("get_bounty", { id: posted.bounty.id });
    if (r.isError) return fail("get_bounty", r.text);
    log(`   status: ${json<DemoBounty>(r.text).status}`);

    log("5. get_budget again");
    r = await call("get_budget", {});
    if (r.isError) return fail("get_budget", r.text);
    const after = json<Budget>(r.text);
    result.remainingAfter = after.remaining_xof;
    log(`   committed ${fmt(after.committed_this_month_xof)}, ${fmt(after.remaining_xof)} left`);

    // Over what is left, but within the per-task max when possible, so the refusal is the budget's.
    const refused = Math.max(REFUSED_BOUNTY.amount_xof, after.remaining_xof + 1000);
    log(`6. post_bounty: ${fmt(refused)} on ${repo}#${refuseIssue} (more than is left)`);
    r = await call("post_bounty", {
      repo,
      issue_number: refuseIssue,
      amount_xof: refused,
      criteria: REFUSED_BOUNTY.criteria,
    });
    if (!r.isError) return fail("refusal", `expected a refusal, got: ${r.text}`);
    if (!/over_budget|over_task_max/.test(r.text)) return fail("refusal", `refused, but not by the budget: ${r.text}`);
    result.refusal = r.text;
    log(`   ✓ refused by the server: ${r.text.split("\n").join("\n     ")}`);

    if (opts.cancel) {
      log("7. cancel_bounty (--cancel)");
      r = await call("cancel_bounty", { id: posted.bounty.id, reason: "demo rehearsal" });
      if (r.isError) return fail("cancel_bounty", r.text);
      log(`   status: ${json<{ bounty: DemoBounty }>(r.text).bounty.status}`);
    }

    result.ok = true;
    return result;
  } catch (err) {
    return fail(result.bounty ? "after post_bounty" : "connect", err instanceof Error ? err.message : String(err));
  } finally {
    await client.close().catch(() => undefined);
  }
}

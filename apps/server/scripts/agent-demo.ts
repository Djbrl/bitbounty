// A5: pnpm --filter @bitbounty/server agent:demo [-- --api <url>] [--issue 2] [--amount 15000] [--refuse-issue 6] [--cancel]
// The stage scenario of docs/demo/agent-demo.md without Claude Code: same MCP server, same tool calls.
// No --api: starts a throw-away local server (in memory, fresh demo key, fake GitHub). Nothing is paid:
// bounties start unfunded and funding is the human owner's step.
// --api <url>: an existing server; the key comes from BITBOUNTY_AGENT_KEY (never on the command line).
import { runAgentDemo, startLocalDemoServer, type DemoBounty, type LocalDemoServer } from "./agent-demo-scenario.js";

const usage =
  "usage: pnpm --filter @bitbounty/server agent:demo [-- --api <url>] [--issue <n>] [--amount <FCFA>] [--refuse-issue <n>] [--cancel]\n" +
  "  with --api, set BITBOUNTY_AGENT_KEY=bb_... in the environment";

const flags = new Map<string, string>();
let cancel = false;
const argv = process.argv.slice(2).filter((a) => a !== "--");
for (let i = 0; i < argv.length; i++) {
  const k = argv[i]!;
  if (k === "--cancel") {
    cancel = true;
    continue;
  }
  const v = argv[i + 1];
  if (!["--api", "--issue", "--amount", "--refuse-issue"].includes(k) || v === undefined) {
    console.error(usage);
    process.exit(1);
  }
  flags.set(k.slice(2), v);
  i++;
}
const int = (name: string) => {
  const raw = flags.get(name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) {
    console.error(`--${name} needs a positive whole number\n${usage}`);
    process.exit(1);
  }
  return n;
};

let local: LocalDemoServer | undefined;
let apiUrl = flags.get("api");
let agentKey = process.env.BITBOUNTY_AGENT_KEY?.trim();
if (apiUrl) {
  if (!agentKey) {
    console.error(`--api needs BITBOUNTY_AGENT_KEY in the environment\n${usage}`);
    process.exit(1);
  }
} else {
  local = await startLocalDemoServer();
  apiUrl = local.url;
  agentKey = local.key;
  console.log(`Local demo server on ${local.url} (in memory, fake GitHub, nothing is paid)`);
  console.log("Demo key: 20 000 FCFA a month, 15 000 FCFA max per task, repo Djbrl/bitbounty-demo\n");
}

const showGithub = (b: DemoBounty) => {
  if (!local) {
    console.log(`   on GitHub: the bot's status comment on https://github.com/${b.repo}/issues/${b.issue_number} (when the app is installed)`);
    return;
  }
  const comment = local.github.commentsOn(b.repo, b.issue_number).at(-1);
  if (!comment) return;
  console.log(`   on GitHub (${b.repo}#${b.issue_number}), the bot posts:`);
  console.log(comment.body.replace(/^<!--.*-->\n?/m, "").trim().split("\n").map((l) => `     │ ${l}`).join("\n"));
};

const result = await runAgentDemo({
  apiUrl,
  agentKey: agentKey!,
  issue: int("issue"),
  amountXof: int("amount"),
  refuseIssue: int("refuse-issue"),
  cancel,
  afterPost: showGithub,
});
await local?.close();
if (result.ok) {
  console.log("\nDone: the agent posted a bounty inside its budget and was refused above it.");
  console.log("Next, human: open the fund link and pay the Lightning invoice. Until then nobody can claim it.");
} else {
  console.error(`\nStopped at ${result.failedStep}.`);
  process.exit(1);
}

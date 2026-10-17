// pnpm --filter @bitbounty/server agent:create --name demo-agent --owner Djbrl --budget 100000 --max 20000 --repos owner/a,owner/b
// Prints the key ONCE and the JSON entry to add to BITBOUNTY_AGENTS (only the key's hash is stored).
import { randomUUID } from "node:crypto";
import { agentSchema, generateAgentKey, hashAgentKey, type Agent } from "./registry.js";

const usage =
  "usage: pnpm --filter @bitbounty/server agent:create --name <name> --owner <github login> --budget <FCFA/month> --max <FCFA/task> --repos <owner/a,owner/b>";
const flags = new Map<string, string>();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  const k = argv[i];
  const v = argv[i + 1];
  if (!k?.startsWith("--") || v === undefined) {
    console.error(usage);
    process.exit(1);
  }
  flags.set(k.slice(2), v);
}
const int = (name: string) => {
  const n = Number(flags.get(name));
  if (!Number.isSafeInteger(n) || n < 1) {
    console.error(`--${name} needs a positive whole number of FCFA\n${usage}`);
    process.exit(1);
  }
  return n;
};
const name = flags.get("name");
const owner = flags.get("owner");
const repos = (flags.get("repos") ?? "").split(",").map((r) => r.trim()).filter(Boolean);
if (!name || !owner || repos.length === 0) {
  console.error(usage);
  process.exit(1);
}

const key = generateAgentKey();
const agent: Agent = {
  id: randomUUID(),
  name,
  ownerLogin: owner,
  keyHash: hashAgentKey(key),
  monthlyBudgetXof: int("budget"),
  perTaskMaxXof: int("max"),
  allowedRepos: repos,
  revoked: false,
};
// Same check as the server at startup: never print an entry it would refuse.
const checked = agentSchema.safeParse(agent);
if (!checked.success) {
  const issue = checked.error.issues[0];
  console.error(`invalid ${issue?.path.join(".") || "agent"}: ${issue?.message} (repos are "owner/name", owner login is 39 chars max)`);
  process.exit(1);
}
console.log(`Agent key (shown once, give it to the agent as BITBOUNTY_AGENT_KEY):\n\n  ${key}\n`);
console.log("Add this entry to the BITBOUNTY_AGENTS array in the server's .env:\n");
console.log(JSON.stringify(agent));

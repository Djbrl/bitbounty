import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

/**
 * An AI agent allowed to fund bounties, inside a budget set by its human owner (docs/product.md:
 * "an agent is a funder like any other"). The key itself is never stored, only its SHA-256.
 */
export interface Agent {
  /** UUID: stored as `bounties.funder_id` for agent-funded bounties. */
  id: string;
  name: string;
  /** GitHub login of the human who answers for this agent. */
  ownerLogin: string;
  keyHash: string;
  monthlyBudgetXof: number;
  perTaskMaxXof: number;
  /** `owner/name`, compared case-insensitively. Empty = no repo allowed. */
  allowedRepos: string[];
  revoked: boolean;
}

export const agentSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(100),
    ownerLogin: z.string().min(1).max(39),
    keyHash: z.string().regex(/^[0-9a-f]{64}$/, "keyHash must be a sha256 hex digest"),
    monthlyBudgetXof: z.number().int().nonnegative(),
    perTaskMaxXof: z.number().int().positive(),
    allowedRepos: z.array(z.string().regex(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/)),
    revoked: z.boolean().default(false),
  })
  .strict();

export const AGENT_KEY_PREFIX = "bb_";

/** A new random key: `bb_` + 43 url-safe chars (32 bytes). Shown once, then only its hash is kept. */
export function generateAgentKey(): string {
  return AGENT_KEY_PREFIX + randomBytes(32).toString("base64url");
}

export function hashAgentKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export interface AgentRegistry {
  /** The agent for this key, or undefined when unknown or revoked (callers can't tell which). */
  findByKey(key: string): Promise<Agent | undefined>;
}

export class StaticAgentRegistry implements AgentRegistry {
  private readonly byHash: Map<string, Agent>;

  constructor(agents: Agent[]) {
    this.byHash = new Map(agents.map((a) => [a.keyHash, a]));
  }

  async findByKey(key: string) {
    if (!key.startsWith(AGENT_KEY_PREFIX) || key.length > 200) return undefined;
    const agent = this.byHash.get(hashAgentKey(key));
    return agent && !agent.revoked ? agent : undefined;
  }
}

/**
 * Agents from the `BITBOUNTY_AGENTS` env var: a JSON array of agents (see docs/agents.md;
 * `pnpm --filter @bitbounty/server agent:create` prints an entry). Throws on an invalid entry
 * so a typo can't silently open or close the door.
 */
export function agentsFromEnv(raw: string | undefined): Agent[] {
  if (!raw?.trim()) return [];
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("BITBOUNTY_AGENTS is not valid JSON (expected an array of agents)");
  }
  const res = z.array(agentSchema).safeParse(json);
  if (!res.success) {
    const issue = res.error.issues[0];
    const [index, ...field] = issue?.path ?? [];
    const where = index === undefined ? "" : ` (entry ${String(index)}${field.length ? `, field ${field.join(".")}` : ""})`;
    throw new Error(`BITBOUNTY_AGENTS is invalid${where}: ${issue?.message ?? "bad entry"}`);
  }
  const ids = new Set<string>();
  const hashes = new Set<string>();
  for (const a of res.data) {
    if (ids.has(a.id)) throw new Error(`BITBOUNTY_AGENTS: duplicate agent id ${a.id}`);
    if (hashes.has(a.keyHash)) throw new Error(`BITBOUNTY_AGENTS: two agents share the same key (${a.name})`);
    ids.add(a.id);
    hashes.add(a.keyHash);
  }
  return res.data;
}

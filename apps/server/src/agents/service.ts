import { randomUUID } from "node:crypto";
import { createBounty, transition, type Bounty, type InternalEvent } from "@bitbounty/core";
import type { BountyRepo } from "../bounties/repo.js";
import type { GithubForRepo } from "../github/claims/github.js";
import type { Lang } from "../github/status-comment/index.js";
import { syncIssue } from "../github/wiring/sync.js";
import { withIssueLock, issueLockKey } from "../github/wiring/handle-comment.js";
import type { Agent } from "./registry.js";
import type { AgentSpending } from "./spending.js";

export interface AgentServiceDeps {
  repo: BountyRepo;
  bus: { publish(event: InternalEvent): unknown };
  spending: AgentSpending;
  /** Web origin for the pay link (`/pay/<id>`). */
  baseUrl: string;
  /** When set, the bot posts its status comment on the issue (same as `/bounty`). */
  github?: GithubForRepo;
  lang?: Lang;
  botLogin?: string;
  now?: () => Date;
  newId?: () => string;
}

export interface PostBountyInput {
  repo: string;
  issueNumber: number;
  issueTitle?: string;
  amountXof: number;
  criteria: string[];
}

/** What agents see. snake_case, like the rest of the public /v1 API. */
export interface AgentBountyView {
  id: string;
  repo: string;
  issue_number: number;
  issue_title: string;
  amount_xof: number;
  status: Bounty["status"];
  criteria: string[];
  fund_url: string;
  created_at: string;
}

export interface BudgetView {
  agent: string;
  owner: string;
  monthly_budget_xof: number;
  committed_this_month_xof: number;
  remaining_xof: number;
  per_task_max_xof: number;
  allowed_repos: string[];
}

export class AgentError extends Error {
  constructor(
    readonly code:
      | "invalid_input"
      | "repo_not_allowed"
      | "over_task_max"
      | "over_budget"
      | "issue_has_bounty"
      | "not_found"
      | "cannot_cancel",
    message: string,
    readonly status: 400 | 403 | 404 | 409,
  ) {
    super(message);
    this.name = "AgentError";
  }
}

const REPO_RE = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
/** Smallest agent bounty: below this a bounty is noise (and each one posts a GitHub comment). */
export const MIN_AGENT_BOUNTY_XOF = 1_000;
/** Largest issue number we accept: `bounties.issue_number` is a Postgres `integer` (int4). */
export const MAX_ISSUE_NUMBER = 2_147_483_647;

/**
 * Why an owner's limits can't work, or undefined when they can (used by `agent:create`):
 * a budget below the smallest bounty, or a per-task max the budget can never cover.
 */
export function agentLimitsError(monthlyBudgetXof: number, perTaskMaxXof: number): string | undefined {
  if (monthlyBudgetXof < MIN_AGENT_BOUNTY_XOF) {
    return `--budget ${monthlyBudgetXof} is below the smallest bounty (${MIN_AGENT_BOUNTY_XOF} FCFA): the agent could never post one`;
  }
  if (perTaskMaxXof > monthlyBudgetXof) {
    return `--max ${perTaskMaxXof} is above --budget ${monthlyBudgetXof}: one task can't cost more than the whole month`;
  }
  return undefined;
}

/**
 * The agent's side of BitBounty: post a bounty (unfunded, the human owner pays it from the
 * returned link), read it, cancel it, check the budget. Every rule is checked here, on the
 * server, whatever the agent claims: allowed repo, per-task max, monthly budget.
 */
export class AgentService {
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: AgentServiceDeps) {}

  async budget(agent: Agent): Promise<BudgetView> {
    const committed = await this.deps.spending.committedThisMonth(agent.id, this.now());
    return {
      agent: agent.name,
      owner: agent.ownerLogin,
      monthly_budget_xof: agent.monthlyBudgetXof,
      committed_this_month_xof: committed,
      remaining_xof: Math.max(0, agent.monthlyBudgetXof - committed),
      per_task_max_xof: agent.perTaskMaxXof,
      allowed_repos: agent.allowedRepos,
    };
  }

  async post(agent: Agent, input: PostBountyInput): Promise<{ bounty: AgentBountyView; warnings: string[] }> {
    const repo = input.repo.trim();
    if (!REPO_RE.test(repo)) throw new AgentError("invalid_input", 'repo must be "owner/name"', 400);
    if (!Number.isSafeInteger(input.issueNumber) || input.issueNumber < 1 || input.issueNumber > MAX_ISSUE_NUMBER) {
      throw new AgentError("invalid_input", `issue_number must be a whole number from 1 to ${MAX_ISSUE_NUMBER}`, 400);
    }
    if (!Number.isSafeInteger(input.amountXof) || input.amountXof < MIN_AGENT_BOUNTY_XOF) {
      throw new AgentError("invalid_input", `amount_xof must be a whole number of FCFA, at least ${MIN_AGENT_BOUNTY_XOF}`, 400);
    }
    const criteria = input.criteria.map((c) => c.trim()).filter(Boolean);
    if (criteria.length < 1 || criteria.length > 6 || criteria.some((c) => c.length > 300)) {
      throw new AgentError("invalid_input", "criteria: 1 to 6 testable sentences, 300 characters max each", 400);
    }
    if (!agent.allowedRepos.some((r) => r.toLowerCase() === repo.toLowerCase())) {
      throw new AgentError("repo_not_allowed", `this agent isn't allowed to post bounties on ${repo}`, 403);
    }
    if (input.amountXof > agent.perTaskMaxXof) {
      throw new AgentError("over_task_max", `amount_xof ${input.amountXof} is above this agent's per-task max of ${agent.perTaskMaxXof} FCFA`, 403);
    }

    // One agent at a time (budget check + insert must not interleave), and one writer per issue
    // (shared with `/bounty` comments so a human and an agent can't race on the same issue).
    return this.withAgentLock(agent.id, () =>
      withIssueLock(issueLockKey(repo, input.issueNumber), async () => {
        const { remaining_xof } = await this.budget(agent);
        if (input.amountXof > remaining_xof) {
          throw new AgentError("over_budget", `amount_xof ${input.amountXof} is above the ${remaining_xof} FCFA left in this month's budget`, 403);
        }
        const { bounty, event } = createBounty({
          id: this.deps.newId?.() ?? randomUUID(),
          repoFullName: repo,
          issueNumber: input.issueNumber,
          issueTitle: (input.issueTitle ?? "").trim().slice(0, 300) || `Issue #${input.issueNumber}`,
          amountXof: input.amountXof,
          criteria: criteria.map((text) => ({ text })),
          funderKind: "agent",
          funderId: agent.id,
          createdAt: this.now().toISOString(),
        });
        const res = await this.deps.repo.create(bounty);
        if (!res.created) {
          throw new AgentError("issue_has_bounty", `${repo}#${input.issueNumber} already has a bounty (${res.bounty.status})`, 409);
        }
        await this.deps.bus.publish(event);
        const warnings = await this.sync(res.bounty);
        return { bounty: this.view(res.bounty), warnings };
      }),
    );
  }

  async get(agent: Agent, id: string): Promise<AgentBountyView> {
    return this.view(await this.own(agent, id));
  }

  async cancel(agent: Agent, id: string, reason = "cancelled by the agent"): Promise<{ bounty: AgentBountyView; warnings: string[] }> {
    const bounty = await this.own(agent, id);
    return withIssueLock(issueLockKey(bounty.repoFullName, bounty.issueNumber), async () => {
      const current = await this.own(agent, id);
      const result = transition(current, {
        type: "bounty.cancelled",
        bountyId: current.id,
        occurredAt: this.now().toISOString(),
        actorId: `agent:${agent.id}`,
        reason: reason.slice(0, 300),
      });
      if (!result.ok) throw new AgentError("cannot_cancel", `can't cancel: ${result.message}`, 409);
      const saved = await this.deps.repo.update(result.bounty, current.status);
      if (!saved) throw new AgentError("cannot_cancel", "the bounty changed meanwhile, try again", 409);
      // Same cleanup as G3's /cancel: leaving `claimed` ends the claim, and the developer is unassigned.
      const warnings: string[] = [];
      const claim = await this.deps.repo.activeClaim(saved.id);
      if (claim) {
        await this.deps.repo.setClaimStatus(claim.id, "released");
        warnings.push(...(await this.unassign(saved, claim.login)));
      }
      await this.deps.bus.publish(result.event);
      warnings.push(...(await this.sync(saved)));
      return { bounty: this.view(saved), warnings };
    });
  }

  /** Only the agent that posted a bounty can see or cancel it; others get 404, not 403. */
  private async own(agent: Agent, id: string): Promise<Bounty> {
    const bounty = /^[0-9a-f-]{36}$/i.test(id) ? await this.deps.repo.findById(id) : undefined;
    if (!bounty || bounty.funderKind !== "agent" || bounty.funderId !== agent.id) {
      throw new AgentError("not_found", "no such bounty for this agent", 404);
    }
    return bounty;
  }

  /** Best effort: the bounty exists even if GitHub is down; the agent gets a warning. */
  private async sync(bounty: Bounty): Promise<string[]> {
    if (!this.deps.github) return [];
    try {
      const { writer } = await this.deps.github(bounty.repoFullName);
      await syncIssue(bounty, {
        writer,
        repo: this.deps.repo,
        baseUrl: this.deps.baseUrl,
        lang: this.deps.lang ?? "en",
        botLogin: this.deps.botLogin,
      });
      return [];
    } catch (err) {
      return [`status comment not updated on GitHub: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`];
    }
  }

  private async unassign(bounty: Bounty, login: string): Promise<string[]> {
    if (!this.deps.github) return [];
    try {
      const { assigner } = await this.deps.github(bounty.repoFullName);
      await assigner.removeAssignees(bounty.repoFullName, bounty.issueNumber, [login]);
      return [];
    } catch (err) {
      return [`@${login} not unassigned on GitHub: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`];
    }
  }

  private view(b: Bounty): AgentBountyView {
    return {
      id: b.id,
      repo: b.repoFullName,
      issue_number: b.issueNumber,
      issue_title: b.issueTitle,
      amount_xof: b.amountXof,
      status: b.status,
      criteria: b.criteria.map((c) => c.text),
      fund_url: `${this.deps.baseUrl.replace(/\/$/, "")}/pay/${encodeURIComponent(b.id)}`,
      created_at: b.createdAt,
    };
  }

  private now() {
    return this.deps.now?.() ?? new Date();
  }

  private async withAgentLock<T>(agentId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(agentId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => undefined);
    this.locks.set(agentId, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(agentId) === tail) this.locks.delete(agentId);
    }
  }
}

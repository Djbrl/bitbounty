import type { Bounty, BountyStatus } from "@bitbounty/core";
import { bounties, type Database } from "@bitbounty/db";
import { and, eq, gte, notInArray, sum } from "drizzle-orm";

/** Bounties that no longer hold the agent's money: they don't count against its budget. */
export const RELEASED: readonly BountyStatus[] = ["cancelled", "refunded"];

/** First instant of the current UTC month: budgets reset every month. */
export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** How much of its monthly budget an agent has committed (bounties posted this month, not released). */
export interface AgentSpending {
  committedThisMonth(agentId: string, now: Date): Promise<number>;
}

/** Scans the bounties (in-memory repo, tests, offline demo). */
export class ListAgentSpending implements AgentSpending {
  constructor(private readonly list: () => Bounty[] | Promise<Bounty[]>) {}

  async committedThisMonth(agentId: string, now: Date) {
    const from = monthStart(now).getTime();
    return (await this.list())
      .filter(
        (b) =>
          b.funderKind === "agent" && b.funderId === agentId && Date.parse(b.createdAt) >= from && !RELEASED.includes(b.status),
      )
      .reduce((s, b) => s + b.amountXof, 0);
  }
}

/** One SUM query on `bounties` (Postgres). */
export class DrizzleAgentSpending implements AgentSpending {
  constructor(private readonly db: Database) {}

  async committedThisMonth(agentId: string, now: Date) {
    const [row] = await this.db
      .select({ total: sum(bounties.amountXof) })
      .from(bounties)
      .where(
        and(
          eq(bounties.funderKind, "agent"),
          eq(bounties.funderId, agentId),
          gte(bounties.createdAt, monthStart(now)),
          notInArray(bounties.status, [...RELEASED]),
        ),
      );
    return Number(row?.total ?? 0);
  }
}

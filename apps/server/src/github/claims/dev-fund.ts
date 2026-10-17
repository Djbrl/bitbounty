import { transition } from "@bitbounty/core";
import { Hono } from "hono";
import type { BountyRepo } from "../../bounties/repo.js";
import type { EventBus } from "../pr/ports.js";
import type { Lang } from "../status-comment/index.js";
import { issueLockKey, withIssueLock } from "../wiring/handle-comment.js";
import { syncIssue } from "../wiring/sync.js";
import type { GithubForRepo } from "./github.js";

export interface DevFundDeps {
  /** Bearer token the caller must send. The route doesn't exist without it. */
  token: string;
  repo: BountyRepo;
  bus: EventBus;
  github: GithubForRepo;
  baseUrl: string;
  lang?: Lang;
  botLogin?: string;
}

/**
 * DEV ONLY, until F5's Bitnob webhook drives `funding.paid`: marks a bounty as paid so
 * `/claim` is legal in a live demo. Mounted only when `DEV_HOOK_TOKEN` is set.
 *   curl -X POST localhost:8787/dev/fund -H "authorization: Bearer $DEV_HOOK_TOKEN" \
 *        -H 'content-type: application/json' -d '{"repo":"owner/name","issue":16}'
 */
export function devFundRoutes(deps: DevFundDeps): Hono {
  const app = new Hono();
  app.post("/dev/fund", async (c) => {
    if (c.req.header("authorization") !== `Bearer ${deps.token}`) return c.json({ error: "unauthorized" }, 401);
    const body = (await c.req.json().catch(() => null)) as { repo?: unknown; issue?: unknown } | null;
    if (typeof body?.repo !== "string" || typeof body.issue !== "number") {
      return c.json({ error: "body must be {repo: 'owner/name', issue: number}" }, 400);
    }
    const repoName = body.repo;
    const issue = body.issue;
    return withIssueLock(issueLockKey(repoName, issue), async () => {
      const bounty = await deps.repo.findByIssue(repoName, issue);
      if (!bounty) return c.json({ error: "no bounty on that issue" }, 404);
      const event = {
        type: "funding.paid" as const,
        bountyId: bounty.id,
        occurredAt: new Date().toISOString(),
        fundingId: `dev-${bounty.id}`,
        rail: "lightning" as const,
        amountXof: bounty.amountXof,
      };
      const r = transition(bounty, event);
      if (!r.ok) return c.json({ error: r.message }, 409);
      const saved = await deps.repo.update(r.bounty, r.from);
      if (!saved) return c.json({ error: "bounty changed, retry" }, 409);
      await deps.bus.publish(event);
      const gh = await deps.github(saved.repoFullName);
      await syncIssue(saved, {
        writer: gh.writer,
        repo: deps.repo,
        baseUrl: deps.baseUrl,
        lang: deps.lang ?? "en",
        botLogin: deps.botLogin,
      });
      return c.json({ ok: true, bountyId: saved.id, status: saved.status });
    });
  });
  return app;
}

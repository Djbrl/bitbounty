import { Hono, type Context } from "hono";
import type { Agent, AgentRegistry } from "./registry.js";
import { AgentError, type AgentService } from "./service.js";

type Env = { Variables: { agent: Agent } };

/**
 * Public agent API (docs/plan.md §3), `Authorization: Bearer bb_...`:
 * - `POST   /v1/bounties`     {repo, issue_number, amount_xof, criteria[], issue_title?}
 * - `GET    /v1/bounties/:id`
 * - `DELETE /v1/bounties/:id` (cancel until a PR is submitted: unfunded → cancelled, funded/claimed → refunded)
 * - `GET    /v1/budget`
 */
export function agentRoutes(registry: AgentRegistry, service: AgentService) {
  const v1 = new Hono<Env>();

  v1.use("/v1/*", async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const key = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
    const agent = key ? await registry.findByKey(key) : undefined;
    // Same answer for missing, wrong and revoked keys: nothing to learn by probing.
    if (!agent) return c.json({ error: "unauthorized", hint: "send Authorization: Bearer <agent key>" }, 401);
    c.set("agent", agent);
    await next();
  });

  v1.get("/v1/budget", (c) => handle(c, async () => c.json(await service.budget(c.get("agent")))));

  v1.post("/v1/bounties", (c) =>
    handle(c, async () => {
      const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body || typeof body !== "object") throw new AgentError("invalid_input", "send a JSON body", 400);
      const criteria = body.criteria;
      if (!Array.isArray(criteria) || !criteria.every((x) => typeof x === "string")) {
        throw new AgentError("invalid_input", "criteria must be an array of strings", 400);
      }
      const result = await service.post(c.get("agent"), {
        repo: typeof body.repo === "string" ? body.repo : "",
        issueNumber: typeof body.issue_number === "number" ? body.issue_number : Number.NaN,
        issueTitle: typeof body.issue_title === "string" ? body.issue_title : undefined,
        amountXof: typeof body.amount_xof === "number" ? body.amount_xof : Number.NaN,
        criteria,
      });
      return c.json(result, 201);
    }),
  );

  v1.get("/v1/bounties/:id", (c) => handle(c, async () => c.json(await service.get(c.get("agent"), c.req.param("id")))));

  v1.delete("/v1/bounties/:id", (c) =>
    handle(c, async () => {
      const body = (await c.req.json().catch(() => ({}))) as { reason?: unknown };
      const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : undefined;
      return c.json(await service.cancel(c.get("agent"), c.req.param("id"), reason));
    }),
  );

  return v1;
}

async function handle(c: Context<Env>, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AgentError) return c.json({ error: err.code, message: err.message }, err.status);
    console.error("[agents]", err);
    return c.json({ error: "internal_error" }, 500);
  }
}

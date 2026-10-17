import { Hono } from "hono";
import { GithubIssuesError, REPO_RE } from "./github-issues.js";
import { priceRepoBacklog, type SuggestOptions } from "./suggest.js";
import type { BacklogResult } from "./types.js";

export interface BacklogRoutesDeps {
  price?: (repoFullName: string) => Promise<BacklogResult>;
  /** Same repo within this window returns the cached result (no GitHub or model call). */
  cacheMs?: number;
  /** Requests per client per minute. */
  perMinute?: number;
  now?: () => number;
}

const STATUS_ERRORS = { 404: "repo_not_found", 429: "github_rate_limited", 502: "github_unavailable" } as const;

/**
 * POST /api/backlog/suggest {"repo": "owner/name"} → BacklogResult.
 * Suggestions only; funding them is POST /api/backlog/fund (mock today, I1 wires it).
 *
 * No user session yet (I1 adds it through the web app), so the route protects itself:
 * the GitHub token is a dedicated `BACKLOG_GITHUB_TOKEN` (never a broad GITHUB_TOKEN from the
 * shell), results are cached per repo, and each client is rate limited, which bounds model cost.
 */
export function backlogRoutes(deps: BacklogRoutesDeps = {}, opts: SuggestOptions = {}) {
  const price =
    deps.price ??
    ((repo: string) =>
      priceRepoBacklog(repo, { ...opts, github: { token: process.env.BACKLOG_GITHUB_TOKEN?.trim() || undefined } }));
  const cacheMs = deps.cacheMs ?? 10 * 60_000;
  const perMinute = deps.perMinute ?? 6;
  const now = deps.now ?? Date.now;
  const cache = new Map<string, { at: number; result: Promise<BacklogResult> }>();
  const hits = new Map<string, number[]>();

  const routes = new Hono();
  routes.post("/api/backlog/suggest", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { repo?: unknown } | null;
    const repo = typeof body?.repo === "string" ? body.repo.trim() : "";
    if (!REPO_RE.test(repo)) return c.json({ error: "invalid_repo", hint: 'send {"repo": "owner/name"}' }, 400);

    const t = now();
    const key = repo.toLowerCase();
    const cached = cache.get(key);
    if (!cached || t - cached.at > cacheMs) {
      const client = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "local";
      const recent = (hits.get(client) ?? []).filter((at) => t - at < 60_000);
      if (recent.length >= perMinute) {
        return c.json({ error: "too_many_requests", hint: "try again in a minute" }, 429);
      }
      hits.set(client, [...recent, t]);
      cache.set(key, { at: t, result: price(repo) });
    }
    try {
      return c.json(await cache.get(key)!.result);
    } catch (err) {
      cache.delete(key); // never cache a failure
      if (err instanceof GithubIssuesError) {
        const status = err.status === 404 || err.status === 429 ? err.status : 502;
        return c.json({ error: STATUS_ERRORS[status], message: err.message }, status);
      }
      return c.json({ error: "backlog_failed" }, 500);
    }
  });
  return routes;
}

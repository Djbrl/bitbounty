import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono, type Context } from "hono";
import { GithubIssuesError, REPO_RE } from "./github-issues.js";
import { BacklogModelError, priceRepoBacklog, type SuggestOptions } from "./suggest.js";
import type { BacklogResult } from "./types.js";

export interface BacklogRoutesDeps {
  price?: (repoFullName: string) => Promise<BacklogResult>;
  /** Same repo within this window returns the cached result (no GitHub or model call). */
  cacheMs?: number;
  /** New (uncached) repos per client per minute. */
  perMinute?: number;
  /** New (uncached) repos per minute for the whole server, whoever asks: the hard bound on model cost. */
  globalPerMinute?: number;
  now?: () => number;
  /** The route's memory, injectable so tests can check it stays bounded. */
  store?: BacklogRouteStore;
}

export interface BacklogRouteStore {
  cache: Map<string, { at: number; result: Promise<BacklogResult> }>;
  hits: Map<string, number[]>;
}

/**
 * Who is asking. The server sits behind a Cloudflare tunnel, which sets `cf-connecting-ip` to the
 * real client. Otherwise the last `x-forwarded-for` hop (added by the nearest proxy; the first ones
 * are whatever the caller sent), else the socket address.
 */
export function clientKey(c: Context): string {
  const cf = c.req.header("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const lastHop = c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim();
  if (lastHop) return lastHop;
  try {
    return getConnInfo(c).remote.address || "local";
  } catch {
    return "local"; // no Node socket (tests, app.request)
  }
}

const STATUS_ERRORS = { 404: "repo_not_found", 429: "github_rate_limited", 502: "github_unavailable" } as const;

/**
 * POST /api/backlog/suggest {"repo": "owner/name"} → BacklogResult.
 * Suggestions only; funding them is POST /api/backlog/fund (mock today, I1 wires it).
 *
 * No user session yet (I1 adds it through the web app), so the route protects itself:
 * the GitHub token is a dedicated `BACKLOG_GITHUB_TOKEN` (never a broad GITHUB_TOKEN from the
 * shell), complete results are cached per repo, each client is rate limited, and a global
 * per-minute cap bounds model cost whatever the client key says.
 */
export function backlogRoutes(deps: BacklogRoutesDeps = {}, opts: SuggestOptions = {}) {
  const price =
    deps.price ??
    ((repo: string) =>
      priceRepoBacklog(repo, { ...opts, github: { token: process.env.BACKLOG_GITHUB_TOKEN?.trim() || undefined } }));
  const cacheMs = deps.cacheMs ?? 10 * 60_000;
  const perMinute = deps.perMinute ?? 6;
  const globalPerMinute = deps.globalPerMinute ?? 20;
  const now = deps.now ?? Date.now;
  const { cache, hits }: BacklogRouteStore = deps.store ?? { cache: new Map(), hits: new Map() };
  let globalHits: number[] = [];

  // Drop expired cache entries and idle clients. Both maps stay small: only requests that passed
  // the global cap add to them, so at most `globalPerMinute` new keys a minute.
  const sweep = (t: number) => {
    for (const [key, entry] of cache) if (t - entry.at > cacheMs) cache.delete(key);
    for (const [client, at] of hits) if (!at.some((a) => t - a < 60_000)) hits.delete(client);
    globalHits = globalHits.filter((a) => t - a < 60_000);
  };

  const routes = new Hono();
  routes.post("/api/backlog/suggest", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { repo?: unknown } | null;
    const repo = typeof body?.repo === "string" ? body.repo.trim() : "";
    if (!REPO_RE.test(repo)) return c.json({ error: "invalid_repo", hint: 'send {"repo": "owner/name"}' }, 400);

    const t = now();
    sweep(t);
    const key = repo.toLowerCase();
    let entry = cache.get(key);
    if (!entry) {
      const client = clientKey(c);
      const recent = (hits.get(client) ?? []).filter((at) => t - at < 60_000);
      if (recent.length >= perMinute) {
        return c.json({ error: "too_many_requests", hint: "try again in a minute" }, 429);
      }
      if (globalHits.length >= globalPerMinute) {
        return c.json({ error: "too_many_requests", hint: "the server is busy, try again in a minute" }, 429);
      }
      hits.set(client, [...recent, t]);
      globalHits.push(t);
      const fresh = { at: t, result: price(repo) };
      cache.set(key, fresh);
      // Only a complete result is worth reusing: a partial or fallback one, or a failure, is retried next time.
      const forget = () => {
        if (cache.get(key) === fresh) cache.delete(key);
      };
      fresh.result.then((result) => {
        if (!result.complete) forget();
      }, forget);
      entry = fresh;
    }
    try {
      return c.json(await entry.result);
    } catch (err) {
      if (err instanceof BacklogModelError) return c.json({ error: "model_unavailable", message: err.message }, 502);
      if (err instanceof GithubIssuesError) {
        const status = err.status === 404 || err.status === 429 ? err.status : 502;
        return c.json({ error: STATUS_ERRORS[status], message: err.message }, status);
      }
      return c.json({ error: "backlog_failed" }, 500);
    }
  });
  return routes;
}

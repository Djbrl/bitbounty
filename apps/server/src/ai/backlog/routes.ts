import { Hono, type Context } from "hono";
import { GithubIssuesError, REPO_RE } from "./github-issues.js";
import { priceRepoBacklog, type SuggestOptions } from "./suggest.js";
import type { BacklogResult } from "./types.js";

export interface BacklogRoutesDeps {
  price?: (repoFullName: string) => Promise<BacklogResult>;
  /** Same repo within this window returns the cached result (no GitHub or model call). */
  cacheMs?: number;
  /** Most repos kept in the cache; the oldest go first. */
  cacheMax?: number;
  /** New (uncached) repos per client per minute. */
  perMinute?: number;
  /** New repos per minute for the whole server, whoever asks: the hard cap on model spend. */
  globalPerMinute?: number;
  /** New repos per UTC day for the whole server. */
  globalPerDay?: number;
  now?: () => number;
}

const STATUS_ERRORS = { 404: "repo_not_found", 429: "github_rate_limited", 502: "github_unavailable" } as const;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/**
 * Who is calling, for the per-client limit. `x-forwarded-for` is a list the caller can start
 * with anything; each proxy appends the address it saw. So the **last** entry is the one our
 * proxy (Railway) added and the only one a client can't choose. Without a proxy: `local`.
 */
export function clientKey(c: Context): string {
  const hops = (c.req.header("x-forwarded-for") ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  return hops.at(-1) || c.req.header("x-real-ip")?.trim() || "local";
}

/**
 * POST /api/backlog/suggest {"repo": "owner/name"} → BacklogResult.
 * Suggestions only; funding them is POST /api/backlog/fund (mock today, I1 wires it).
 *
 * No user session yet (I1 adds it through the web app), so the route protects itself:
 * the GitHub token is a dedicated `BACKLOG_GITHUB_TOKEN` (never a broad GITHUB_TOKEN from the
 * shell), results are cached per repo, each client is rate limited, and a **global** cap per
 * minute and per day bounds model cost even if someone rotates addresses.
 */
export function backlogRoutes(deps: BacklogRoutesDeps = {}, opts: SuggestOptions = {}) {
  const price =
    deps.price ??
    ((repo: string) =>
      priceRepoBacklog(repo, { ...opts, github: { token: process.env.BACKLOG_GITHUB_TOKEN?.trim() || undefined } }));
  const cacheMs = deps.cacheMs ?? 10 * MINUTE;
  const cacheMax = deps.cacheMax ?? 500;
  const perMinute = deps.perMinute ?? 6;
  const globalPerMinute = deps.globalPerMinute ?? Number(process.env.BACKLOG_GLOBAL_PER_MINUTE ?? 20);
  const globalPerDay = deps.globalPerDay ?? Number(process.env.BACKLOG_GLOBAL_PER_DAY ?? 300);
  const now = deps.now ?? Date.now;
  const cache = new Map<string, { at: number; result: Promise<BacklogResult> }>();
  const hits = new Map<string, number[]>();
  let global: number[] = [];
  let day = { start: 0, count: 0 };

  /** Drops expired entries so the maps can't grow without bound. */
  const prune = (t: number) => {
    for (const [k, v] of cache) if (t - v.at > cacheMs) cache.delete(k);
    while (cache.size > cacheMax) cache.delete(cache.keys().next().value!);
    for (const [k, v] of hits) {
      const recent = v.filter((at) => t - at < MINUTE);
      if (recent.length) hits.set(k, recent);
      else hits.delete(k);
    }
    global = global.filter((at) => t - at < MINUTE);
  };

  const routes = new Hono();
  routes.post("/api/backlog/suggest", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { repo?: unknown } | null;
    const repo = typeof body?.repo === "string" ? body.repo.trim() : "";
    if (!REPO_RE.test(repo)) return c.json({ error: "invalid_repo", hint: 'send {"repo": "owner/name"}' }, 400);

    const t = now();
    prune(t);
    const key = repo.toLowerCase();
    if (!cache.has(key)) {
      const client = clientKey(c);
      if ((hits.get(client) ?? []).length >= perMinute) {
        return c.json({ error: "too_many_requests", hint: "try again in a minute" }, 429);
      }
      const today = Math.floor(t / DAY) * DAY;
      if (day.start !== today) day = { start: today, count: 0 };
      if (global.length >= globalPerMinute || day.count >= globalPerDay) {
        return c.json({ error: "busy", hint: "too many backlogs priced right now, try again later" }, 429);
      }
      hits.set(client, [...(hits.get(client) ?? []), t]);
      global.push(t);
      day.count++;
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

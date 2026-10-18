/**
 * U1: the top languages of a GitHub user's own public repos, to pre-fill the stack chips on /welcome.
 * Public API, no token (60 requests/hour per server IP), so results are cached per login; any
 * failure (rate limit, unknown user, timeout) is an empty list, never an error for the page.
 */
export interface GithubLanguagesOptions {
  fetch?: typeof fetch;
  /** Cache lifetime of a successful answer. Default 6 h. */
  ttlMs?: number;
  /** Cache lifetime of a failure, so a rate limit isn't hammered. Default 5 min. */
  failureTtlMs?: number;
  timeoutMs?: number;
  /** How many languages to return. Default 8. */
  limit?: number;
  /** Logins kept in the cache (oldest dropped). Default 500. */
  maxEntries?: number;
  now?: () => number;
}

const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export function githubLanguages(opts: GithubLanguagesOptions = {}) {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const ttl = opts.ttlMs ?? 6 * 3600_000;
  const failureTtl = opts.failureTtlMs ?? 5 * 60_000;
  const limit = opts.limit ?? 8;
  const maxEntries = opts.maxEntries ?? 500;
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { until: number; value: Promise<string[]> }>();

  async function load(login: string): Promise<string[] | null> {
    try {
      const res = await doFetch(`https://api.github.com/users/${encodeURIComponent(login)}/repos?per_page=100&sort=pushed&type=owner`, {
        headers: { accept: "application/vnd.github+json", "user-agent": "bitbounty-onboarding" },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 4_000),
      });
      if (!res.ok) return null;
      const list: unknown = await res.json();
      if (!Array.isArray(list)) return null;
      return topLanguages(list, limit);
    } catch {
      return null;
    }
  }

  return async function languagesOf(login: string): Promise<string[]> {
    if (!LOGIN_RE.test(login)) return [];
    const key = login.toLowerCase();
    const hit = cache.get(key);
    if (hit && hit.until > now()) return hit.value;
    const value = load(login).then((langs) => {
      if (langs === null) cache.set(key, { until: now() + failureTtl, value: Promise.resolve([]) });
      return langs ?? [];
    });
    cache.delete(key);
    cache.set(key, { until: now() + ttl, value });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
    return value;
  };
}

/** Counts `language` over the repos (forks skipped), most used first, ties by name. */
export function topLanguages(repos: unknown[], limit = 8): string[] {
  const count = new Map<string, number>();
  for (const r of repos) {
    if (!r || typeof r !== "object") continue;
    const { language, fork } = r as { language?: unknown; fork?: unknown };
    if (fork === true || typeof language !== "string" || !language) continue;
    count.set(language, (count.get(language) ?? 0) + 1);
  }
  return [...count]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([l]) => l);
}

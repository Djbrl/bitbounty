import type { BacklogIssue } from "./types.js";

export const REPO_RE = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

export interface FetchIssuesOptions {
  /** Token for private repos and a higher rate limit (installation token or PAT). Optional for public repos. */
  token?: string;
  /** Stop after this many issues (pull requests don't count). */
  limit?: number;
  fetchImpl?: typeof fetch;
}

interface GithubIssue {
  number: number;
  title: string;
  body: string | null;
  labels: (string | { name?: string })[];
  comments: number;
  updated_at: string;
  assignee: unknown;
  pull_request?: unknown;
}

export class GithubIssuesError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GithubIssuesError";
  }
}

/**
 * Open, unassigned issues of a repo, most recently updated first. Pull requests are skipped
 * (the issues API returns both). Pages of 100 until `limit` or the end.
 */
export async function fetchOpenIssues(repoFullName: string, opts: FetchIssuesOptions = {}): Promise<BacklogIssue[]> {
  if (!REPO_RE.test(repoFullName)) throw new GithubIssuesError(`invalid repo "${repoFullName}" (expected owner/name)`, 400);
  const limit = opts.limit ?? 200;
  const doFetch = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "bitbounty",
  };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;

  const out: BacklogIssue[] = [];
  for (let page = 1; out.length < limit && page <= 10; page++) {
    const url = `https://api.github.com/repos/${repoFullName}/issues?state=open&sort=updated&direction=desc&per_page=100&page=${page}`;
    let res: Response;
    let items: unknown;
    try {
      res = await doFetch(url, { headers });
    } catch (err) {
      throw new GithubIssuesError(`GitHub unreachable: ${err instanceof Error ? err.message : String(err)}`, 502);
    }
    if (res.status === 404) throw new GithubIssuesError(`repo ${repoFullName} not found or not accessible`, 404);
    if (res.status === 429 || (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0")) {
      const reset = Number(res.headers.get("x-ratelimit-reset"));
      const at = Number.isFinite(reset) && reset > 0 ? ` until ${new Date(reset * 1000).toISOString()}` : "";
      throw new GithubIssuesError(`GitHub rate limit reached${at}`, 429);
    }
    if (!res.ok) throw new GithubIssuesError(`GitHub answered ${res.status} for ${repoFullName}`, 502);
    try {
      items = await res.json();
    } catch {
      throw new GithubIssuesError("GitHub sent invalid JSON", 502);
    }
    if (!Array.isArray(items)) throw new GithubIssuesError("GitHub sent an unexpected answer", 502);
    for (const i of items as GithubIssue[]) {
      if (i.pull_request || i.assignee) continue;
      out.push({
        number: i.number,
        title: i.title,
        body: i.body ?? "",
        labels: i.labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))).filter(Boolean),
        comments: i.comments,
        updatedAt: i.updated_at,
      });
      if (out.length >= limit) break;
    }
    if ((items as unknown[]).length < 100) break;
  }
  return out;
}

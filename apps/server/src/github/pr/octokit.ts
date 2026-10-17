import type { CiReader, CommentTarget, PrNotifier } from "./ports.js";

/** The slice of Octokit the adapters use (`octokit.request`). */
export interface RequestClient {
  request(route: string, params: Record<string, unknown>): Promise<{ data: unknown }>;
}
export type ClientFor = (installationId: number) => Promise<RequestClient>;

/** Our own check (A2) is the verdict, not CI: it is left out of `ciGreen`. */
export const BITBOUNTY_CHECK_NAME = "BitBounty verification";

function split(repo: string) {
  const [owner, name] = repo.split("/");
  return { owner, repo: name };
}

/** Posts comments as the GitHub App installation. */
export class OctokitNotifier implements PrNotifier {
  constructor(private clientFor: ClientFor) {}

  async comment(target: CommentTarget, body: string): Promise<void> {
    if (target.installationId === null) throw new Error("pull_request event without installation id");
    const client = await this.clientFor(target.installationId);
    await client.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
      ...split(target.repo),
      issue_number: target.issueNumber,
      body,
    });
  }
}

interface CheckRuns {
  check_runs: Array<{ name: string; status: string; conclusion: string | null }>;
}
interface CombinedStatus {
  state: string;
  total_count: number;
}

const OK_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

/**
 * Green = every check run (except ours) completed OK and the legacy combined status is
 * success (or the repo has none). Any API error counts as not green: the bounty then
 * goes `on_hold` and the maintainer decides, which is the safe side.
 */
export class OctokitCiReader implements CiReader {
  constructor(private clientFor: ClientFor) {}

  async isGreen(target: { repo: string; sha: string; installationId: number | null }): Promise<boolean> {
    if (target.installationId === null) return false;
    try {
      const client = await this.clientFor(target.installationId);
      const params = { ...split(target.repo), ref: target.sha, per_page: 100 };
      const runs = (await client.request("GET /repos/{owner}/{repo}/commits/{ref}/check-runs", params))
        .data as CheckRuns;
      const status = (await client.request("GET /repos/{owner}/{repo}/commits/{ref}/status", params))
        .data as CombinedStatus;
      const runsOk = runs.check_runs
        .filter((r) => r.name !== BITBOUNTY_CHECK_NAME)
        .every((r) => r.status === "completed" && OK_CONCLUSIONS.has(r.conclusion ?? ""));
      const statusOk = status.total_count === 0 || status.state === "success";
      return runsOk && statusOk;
    } catch (err) {
      console.warn(`[pr] CI status unavailable for ${target.repo}@${target.sha}:`, err);
      return false;
    }
  }
}

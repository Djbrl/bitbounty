import type { ClientFor } from "../../github/pr/octokit.js";
import type { VerifyCi } from "../verifier/index.js";
import { summarizeCi } from "./summary.js";
import { CHECK_NAME, type CheckConclusion, type CheckRunGithub, type CheckRunOutput, type CheckRunTarget } from "./types.js";

/** Hard cap on the raw diff we hold in memory; `verify()` then truncates to its own budget. */
export const MAX_RAW_DIFF_CHARS = 2_000_000;

function split(repo: string) {
  const [owner, name] = repo.split("/");
  return { owner, repo: name };
}

/** Real adapter: the GitHub App installation token (`checks:write`, `pull_requests:read`). */
export class OctokitCheckRunGithub implements CheckRunGithub {
  constructor(
    private clientFor: ClientFor,
    private checkName = CHECK_NAME,
  ) {}

  async createCheckRun(t: CheckRunTarget, headSha: string, output: CheckRunOutput): Promise<number> {
    const client = await this.clientFor(t.installationId);
    const res = await client.request("POST /repos/{owner}/{repo}/check-runs", {
      ...split(t.repo),
      name: this.checkName,
      head_sha: headSha,
      status: "in_progress",
      started_at: new Date().toISOString(),
      output,
    });
    return (res.data as { id: number }).id;
  }

  async completeCheckRun(t: CheckRunTarget, id: number, conclusion: CheckConclusion, output: CheckRunOutput) {
    const client = await this.clientFor(t.installationId);
    await client.request("PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}", {
      ...split(t.repo),
      check_run_id: id,
      status: "completed",
      conclusion,
      completed_at: new Date().toISOString(),
      output,
    });
  }

  async getPrDiff(t: CheckRunTarget, prNumber: number): Promise<string> {
    const client = await this.clientFor(t.installationId);
    const res = await client.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
      ...split(t.repo),
      pull_number: prNumber,
      headers: { accept: "application/vnd.github.diff" },
    });
    const diff = typeof res.data === "string" ? res.data : String(res.data ?? "");
    return diff.length > MAX_RAW_DIFF_CHARS ? diff.slice(0, MAX_RAW_DIFF_CHARS) : diff;
  }

  async getPrHeadSha(t: CheckRunTarget, prNumber: number): Promise<string> {
    const client = await this.clientFor(t.installationId);
    const res = await client.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
      ...split(t.repo),
      pull_number: prNumber,
    });
    return (res.data as { head: { sha: string } }).head.sha;
  }

  async getCiStatus(t: CheckRunTarget, sha: string): Promise<VerifyCi> {
    try {
      const client = await this.clientFor(t.installationId);
      const [runs, combined] = await Promise.all([
        client.request("GET /repos/{owner}/{repo}/commits/{ref}/check-runs", { ...split(t.repo), ref: sha, per_page: 100 }),
        client.request("GET /repos/{owner}/{repo}/commits/{ref}/status", { ...split(t.repo), ref: sha }),
      ]);
      return summarizeCi(
        (runs.data as { check_runs: Array<{ name: string; status: string; conclusion: string | null }> }).check_runs,
        combined.data as { state: string; total_count: number },
        this.checkName,
      );
    } catch {
      return { status: "unknown" };
    }
  }

  async getIssue(t: CheckRunTarget, issueNumber: number) {
    const client = await this.clientFor(t.installationId);
    const res = await client.request("GET /repos/{owner}/{repo}/issues/{issue_number}", {
      ...split(t.repo),
      issue_number: issueNumber,
    });
    const d = res.data as { title?: string; body?: string | null };
    return { title: d.title ?? "", body: d.body ?? "" };
  }
}

import type { App } from "@octokit/app";
import { octokitWriter, type GithubWriter, type RequestClient } from "../wiring/writer.js";

/** Assigning the claimant on the issue (and taking it back on expiry or `/unclaim`). */
export interface IssueAssigner {
  addAssignees(repo: string, issueNumber: number, logins: string[]): Promise<void>;
  removeAssignees(repo: string, issueNumber: number, logins: string[]): Promise<void>;
}

/** GitHub clients for a repo. Timers fire outside any webhook, so they find the installation by repo. */
export type GithubForRepo = (repoFullName: string) => Promise<{ writer: GithubWriter; assigner: IssueAssigner }>;

function split(repo: string) {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error(`bad repo name ${JSON.stringify(repo)}`);
  return { owner, repo: name };
}

export function octokitAssigner(client: RequestClient): IssueAssigner {
  return {
    async addAssignees(repo, issueNumber, logins) {
      if (logins.length === 0) return;
      await client.request("POST /repos/{owner}/{repo}/issues/{issue_number}/assignees", {
        ...split(repo),
        issue_number: issueNumber,
        assignees: logins,
      });
    },
    async removeAssignees(repo, issueNumber, logins) {
      if (logins.length === 0) return;
      await client.request("DELETE /repos/{owner}/{repo}/issues/{issue_number}/assignees", {
        ...split(repo),
        issue_number: issueNumber,
        assignees: logins,
      });
    },
  };
}

/** Resolves the app's installation on a repo (cached), then acts as that installation. */
export function appGithubForRepo(app: App): GithubForRepo {
  const installations = new Map<string, number>();
  return async (repoFullName) => {
    const key = repoFullName.toLowerCase();
    let id = installations.get(key);
    if (id === undefined) {
      const res = await app.octokit.request("GET /repos/{owner}/{repo}/installation", split(repoFullName));
      id = res.data.id as number;
      installations.set(key, id);
    }
    const client = (await app.getInstallationOctokit(id)) as unknown as RequestClient;
    return { writer: octokitWriter(client), assigner: octokitAssigner(client) };
  };
}

/** Records assignees in memory (tests). */
export class FakeAssigner implements IssueAssigner {
  readonly assignees = new Map<string, Set<string>>();
  readonly calls: string[] = [];

  of(repo: string, issueNumber: number): string[] {
    return [...(this.assignees.get(`${repo}#${issueNumber}`) ?? [])];
  }
  async addAssignees(repo: string, issueNumber: number, logins: string[]) {
    this.calls.push(`assign ${repo}#${issueNumber} ${logins.join(",")}`);
    const set = this.assignees.get(`${repo}#${issueNumber}`) ?? new Set<string>();
    logins.forEach((l) => set.add(l));
    this.assignees.set(`${repo}#${issueNumber}`, set);
  }
  async removeAssignees(repo: string, issueNumber: number, logins: string[]) {
    this.calls.push(`unassign ${repo}#${issueNumber} ${logins.join(",")}`);
    logins.forEach((l) => this.assignees.get(`${repo}#${issueNumber}`)?.delete(l));
  }
}

import type { App } from "@octokit/app";
import type { GithubLabel } from "../status-comment/index.js";

/**
 * Every GitHub call the wiring makes, behind one small interface so tests run on a fake.
 * `repo` is always `owner/name`.
 */
export interface IssueComment {
  id: number;
  body: string;
  authorLogin: string;
  authorType: string | undefined;
}

export interface GithubWriter {
  /** The user's permission on the repo (`admin|maintain|write|triage|read|none`), undefined if unknown. */
  getPermission(repo: string, login: string): Promise<string | undefined>;
  createComment(repo: string, issueNumber: number, body: string): Promise<number>;
  /** false when the comment no longer exists (deleted by someone). */
  updateComment(repo: string, commentId: number, body: string): Promise<boolean>;
  listComments(repo: string, issueNumber: number): Promise<IssueComment[]>;
  /** Creates the label in the repo if missing (name, colour, description). */
  ensureLabel(repo: string, label: GithubLabel): Promise<void>;
  listIssueLabels(repo: string, issueNumber: number): Promise<string[]>;
  addLabels(repo: string, issueNumber: number, names: string[]): Promise<void>;
  /** No-op when the label isn't on the issue. */
  removeLabel(repo: string, issueNumber: number, name: string): Promise<void>;
}

export type GithubWriterFactory = (installationId: number) => Promise<GithubWriter>;

/** The bit of Octokit we use; structural so tests and Octokit versions don't fight over overloads. */
export interface RequestClient {
  request(route: string, params?: Record<string, unknown>): Promise<{ status: number; data: any }>;
}

function split(repo: string) {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error(`bad repo name ${JSON.stringify(repo)}`);
  return { owner, repo: name };
}

const statusOf = (err: unknown) => (err as { status?: number } | null)?.status;

export function octokitWriter(client: RequestClient): GithubWriter {
  return {
    async getPermission(repo, login) {
      try {
        const res = await client.request("GET /repos/{owner}/{repo}/collaborators/{username}/permission", {
          ...split(repo),
          username: login,
        });
        return typeof res.data?.permission === "string" ? res.data.permission : undefined;
      } catch (err) {
        if (statusOf(err) === 404) return "none";
        return undefined;
      }
    },
    async createComment(repo, issueNumber, body) {
      const res = await client.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
        ...split(repo),
        issue_number: issueNumber,
        body,
      });
      return res.data.id as number;
    },
    async updateComment(repo, commentId, body) {
      try {
        await client.request("PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}", {
          ...split(repo),
          comment_id: commentId,
          body,
        });
        return true;
      } catch (err) {
        if (statusOf(err) === 404) return false;
        throw err;
      }
    },
    async listComments(repo, issueNumber) {
      const out: IssueComment[] = [];
      for (let page = 1; page <= 10; page++) {
        const res = await client.request("GET /repos/{owner}/{repo}/issues/{issue_number}/comments", {
          ...split(repo),
          issue_number: issueNumber,
          per_page: 100,
          page,
        });
        const rows = Array.isArray(res.data) ? res.data : [];
        for (const c of rows) {
          out.push({ id: c.id, body: c.body ?? "", authorLogin: c.user?.login ?? "", authorType: c.user?.type });
        }
        if (rows.length < 100) break;
      }
      return out;
    },
    async ensureLabel(repo, label) {
      try {
        await client.request("POST /repos/{owner}/{repo}/labels", { ...split(repo), ...label });
      } catch (err) {
        if (statusOf(err) !== 422) throw err; // 422 = already exists
      }
    },
    async listIssueLabels(repo, issueNumber) {
      const res = await client.request("GET /repos/{owner}/{repo}/issues/{issue_number}/labels", {
        ...split(repo),
        issue_number: issueNumber,
        per_page: 100,
      });
      return (Array.isArray(res.data) ? res.data : []).map((l: { name: string }) => l.name);
    },
    async addLabels(repo, issueNumber, names) {
      if (names.length === 0) return;
      await client.request("POST /repos/{owner}/{repo}/issues/{issue_number}/labels", {
        ...split(repo),
        issue_number: issueNumber,
        labels: names,
      });
    },
    async removeLabel(repo, issueNumber, name) {
      try {
        await client.request("DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}", {
          ...split(repo),
          issue_number: issueNumber,
          name,
        });
      } catch (err) {
        if (statusOf(err) !== 404) throw err;
      }
    },
  };
}

/** Writer factory acting as the app's installation (comments appear as `<app>[bot]`). */
export function installationWriterFactory(app: App): GithubWriterFactory {
  return async (installationId) =>
    octokitWriter((await app.getInstallationOctokit(installationId)) as unknown as RequestClient);
}

/** In-memory GitHub for tests: records every write. */
export class FakeGithubWriter implements GithubWriter {
  permissions = new Map<string, string>();
  comments = new Map<number, IssueComment & { repo: string; issueNumber: number }>();
  issueLabels = new Map<string, Set<string>>();
  repoLabels = new Map<string, GithubLabel>();
  /** Every call, in order, e.g. `createComment o/r#1`. */
  calls: string[] = [];
  private nextId = 1000;

  constructor(readonly botLogin = "bitbounty-dakar[bot]") {}

  private key(repo: string, n: number) {
    return `${repo}#${n}`;
  }

  /** Comments on one issue, oldest first. */
  commentsOn(repo: string, issueNumber: number) {
    return [...this.comments.values()].filter((c) => c.repo === repo && c.issueNumber === issueNumber);
  }

  labelsOn(repo: string, issueNumber: number) {
    return [...(this.issueLabels.get(this.key(repo, issueNumber)) ?? [])];
  }

  /** Simulates a human comment (or a deleted one, via `comments.delete`). */
  addComment(repo: string, issueNumber: number, body: string, authorLogin: string, authorType = "User") {
    const id = this.nextId++;
    this.comments.set(id, { id, body, authorLogin, authorType, repo, issueNumber });
    return id;
  }

  async getPermission(repo: string, login: string) {
    this.calls.push(`getPermission ${repo} ${login}`);
    return this.permissions.get(login) ?? "none";
  }
  async createComment(repo: string, issueNumber: number, body: string) {
    this.calls.push(`createComment ${this.key(repo, issueNumber)}`);
    return this.addComment(repo, issueNumber, body, this.botLogin, "Bot");
  }
  async updateComment(_repo: string, commentId: number, body: string) {
    this.calls.push(`updateComment ${commentId}`);
    const c = this.comments.get(commentId);
    if (!c) return false;
    c.body = body;
    return true;
  }
  async listComments(repo: string, issueNumber: number) {
    this.calls.push(`listComments ${this.key(repo, issueNumber)}`);
    return this.commentsOn(repo, issueNumber).map(({ id, body, authorLogin, authorType }) => ({
      id,
      body,
      authorLogin,
      authorType,
    }));
  }
  async ensureLabel(_repo: string, label: GithubLabel) {
    this.repoLabels.set(label.name, label);
  }
  async listIssueLabels(repo: string, issueNumber: number) {
    return this.labelsOn(repo, issueNumber);
  }
  async addLabels(repo: string, issueNumber: number, names: string[]) {
    const k = this.key(repo, issueNumber);
    const set = this.issueLabels.get(k) ?? new Set<string>();
    names.forEach((n) => set.add(n));
    this.issueLabels.set(k, set);
  }
  async removeLabel(repo: string, issueNumber: number, name: string) {
    this.issueLabels.get(this.key(repo, issueNumber))?.delete(name);
  }
}

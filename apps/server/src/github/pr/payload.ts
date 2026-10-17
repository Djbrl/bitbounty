/** The few fields of GitHub's `pull_request` webhook payload the handlers use. */
export interface PullRequestPayload {
  action: string;
  repo: string;
  installationId: number | null;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  merged: boolean;
  mergeCommitSha: string | null;
  mergedAt: string | null;
  mergedBy: string | null;
  authorLogin: string;
  headSha: string;
  /** `owner/name` of the head repo; differs from `repo` for a fork, null if the fork was deleted. */
  headRepo: string | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const login = (v: unknown): string | null => (isObj(v) ? str(v.login) : null);

/** Returns null when the payload isn't a usable `pull_request` event. */
export function parsePullRequestPayload(payload: unknown): PullRequestPayload | null {
  if (!isObj(payload) || !isObj(payload.pull_request) || !isObj(payload.repository)) return null;
  const pr = payload.pull_request;
  const repo = str(payload.repository.full_name);
  const action = str(payload.action);
  const author = login(pr.user);
  const head = isObj(pr.head) ? pr.head : null;
  const headSha = head ? str(head.sha) : null;
  if (!repo || !action || !author || !headSha || typeof pr.number !== "number") return null;

  const installation = isObj(payload.installation) ? payload.installation.id : null;
  return {
    action,
    repo,
    installationId: typeof installation === "number" ? installation : null,
    number: pr.number,
    title: str(pr.title) ?? "",
    body: str(pr.body),
    state: pr.state === "closed" ? "closed" : "open",
    merged: pr.merged === true,
    mergeCommitSha: str(pr.merge_commit_sha),
    mergedAt: str(pr.merged_at),
    mergedBy: login(pr.merged_by),
    authorLogin: author,
    headSha,
    headRepo: head && isObj(head.repo) ? str(head.repo.full_name) : null,
  };
}

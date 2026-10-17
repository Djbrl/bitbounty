import type { Bounty } from "@bitbounty/core";
import type { BountyRepo } from "../../bounties/repo.js";
import {
  amountLabel,
  isStatusComment,
  labelFor,
  renderStatusComment,
  STATUS_LABEL_NAMES,
  type Lang,
  type StatusCommentExtras,
} from "../status-comment/index.js";
import type { GithubWriter } from "./writer.js";

export interface SyncOptions {
  writer: GithubWriter;
  repo: BountyRepo;
  baseUrl: string;
  lang: Lang;
  /** Extra fields for the comment (claim, PR…), besides `baseUrl`. */
  extras?: Omit<StatusCommentExtras, "baseUrl">;
  /** Only comments by this login (our app) can be "the" status comment. */
  botLogin?: string;
}

const AMOUNT_LABEL = /^💰 .* FCFA$/u;

/**
 * Makes GitHub match the bounty: one status comment, edited in place, and exactly one
 * `bounty: <status>` label (+ the amount label). Safe to call again: it converges.
 * Returns the status comment id.
 */
export async function syncIssue(bounty: Bounty, opts: SyncOptions): Promise<number> {
  const { writer, repo } = opts;
  const body = renderStatusComment(bounty, { ...opts.extras, baseUrl: opts.baseUrl }, opts.lang);
  const repoName = bounty.repoFullName;

  let commentId: number | null = null;
  if (bounty.statusCommentId !== null && (await writer.updateComment(repoName, bounty.statusCommentId, body))) {
    commentId = bounty.statusCommentId;
  }
  if (commentId === null) {
    // Lost the id (or the comment was deleted): look for our marker before posting a new one.
    // Only a bot's comment counts, so a human pasting the marker can't hijack the edits.
    const found = (await writer.listComments(repoName, bounty.issueNumber)).find(
      (c) =>
        isStatusComment(c.body, bounty.id) &&
        (opts.botLogin ? c.authorLogin.toLowerCase() === opts.botLogin.toLowerCase() : c.authorType === "Bot"),
    );
    if (found && (await writer.updateComment(repoName, found.id, body))) commentId = found.id;
    else commentId = await writer.createComment(repoName, bounty.issueNumber, body);
  }
  if (commentId !== bounty.statusCommentId) await repo.setStatusCommentId(bounty.id, commentId);

  const status = labelFor(bounty.status);
  const amount = amountLabel(bounty.amountXof);
  const current = await writer.listIssueLabels(repoName, bounty.issueNumber);
  const stale = current.filter(
    (n) => (STATUS_LABEL_NAMES.includes(n) && n !== status.name) || (AMOUNT_LABEL.test(n) && n !== amount.name),
  );
  const missing = [status, amount].filter((l) => !current.includes(l.name));
  for (const l of missing) await writer.ensureLabel(repoName, l);
  await writer.addLabels(
    repoName,
    bounty.issueNumber,
    missing.map((l) => l.name),
  );
  for (const n of stale) await writer.removeLabel(repoName, bounty.issueNumber, n);

  return commentId;
}

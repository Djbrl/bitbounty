import { transition, type Bounty, type BountyStatus, type InternalEvent } from "@bitbounty/core";
import type { GithubDispatcher } from "../dispatcher.js";
import { linkedIssues, type IssueRef } from "./linked-issues.js";
import { missingLinkMessage, notClaimantMessage, unclaimedMessage } from "./messages.js";
import { parsePullRequestPayload, type PullRequestPayload } from "./payload.js";
import type { PrDeps } from "./ports.js";

export type SkipReason =
  | "no_bounty"
  | "unfunded"
  | "unclaimed"
  | "not_claimant"
  | "not_open"
  | "illegal_transition";

export type PrOutcome =
  | { kind: "linked"; issue: number; bountyId: string; headSha: string }
  | { kind: "already_linked"; issue: number; bountyId: string }
  | { kind: "merged"; issue: number; bountyId: string; to: BountyStatus; ciGreen: boolean }
  | { kind: "asked_maintainer"; issue: number; bountyId: string }
  | { kind: "skipped"; issue: number; bountyId?: string; reason: SkipReason };

export interface PrResult {
  outcomes: PrOutcome[];
  /** "Fixes other/repo#n" references: never linked, returned for logging. */
  crossRepo: IssueRef[];
}

/** Actions that (re)link a PR to its bounty. `reopened` covers "closed without merge, then reopened". */
const LINK_ACTIONS = new Set(["opened", "edited", "synchronize", "reopened"]);
/** Actions after which a non-claimant gets a comment (not on every push/edit, to avoid spam). */
const NOTIFY_ACTIONS = new Set(["opened", "reopened"]);

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Handles one `pull_request` webhook. `opened`/`edited`/`synchronize`/`reopened` link the
 * PR to claimed bounties (→ `pr.linked`); `closed` + merged emits `pr.merged`, or asks the
 * maintainer when the merge isn't tied to the bounty. Everything else is a no-op.
 */
export async function handlePullRequest(pr: PullRequestPayload, deps: PrDeps): Promise<PrResult> {
  const refs = linkedIssues(pr.body, pr.title, pr.repo);
  const result: PrResult = { outcomes: [], crossRepo: refs.crossRepo };
  if (LINK_ACTIONS.has(pr.action) && pr.state === "open") {
    for (const issue of refs.issues) result.outcomes.push(await link(pr, issue, deps));
  } else if (pr.action === "closed" && pr.merged) {
    result.outcomes = await onMerged(pr, refs.issues, deps);
  }
  return result;
}

async function link(pr: PullRequestPayload, issue: number, deps: PrDeps): Promise<PrOutcome> {
  const { bounties } = deps;
  const bounty = await bounties.findByIssue(pr.repo, issue);
  if (!bounty) return { kind: "skipped", issue, reason: "no_bounty" };
  const skip = (reason: SkipReason): PrOutcome => ({ kind: "skipped", issue, bountyId: bounty.id, reason });
  const prTarget = { repo: pr.repo, issueNumber: pr.number, installationId: pr.installationId };

  if (bounty.status === "unfunded") return skip("unfunded");
  if (bounty.status === "funded") {
    if (NOTIFY_ACTIONS.has(pr.action)) {
      await deps.notifier.comment(prTarget, unclaimedMessage(issue, pr.authorLogin));
    }
    return skip("unclaimed");
  }
  if (bounty.status !== "claimed" && bounty.status !== "submitted") return skip("not_open");

  const claimant = await bounties.activeClaimant(bounty.id);
  if (!claimant) return skip("unclaimed");
  if (!same(claimant.login, pr.authorLogin)) {
    if (NOTIFY_ACTIONS.has(pr.action)) {
      await deps.notifier.comment(prTarget, notClaimantMessage(issue, claimant.login, pr.authorLogin));
    }
    return skip("not_claimant");
  }

  const current = await bounties.currentSubmission(bounty.id);
  if (bounty.status === "submitted" && current?.prNumber === pr.number && current.headSha === pr.headSha) {
    return { kind: "already_linked", issue, bountyId: bounty.id }; // redelivery or body edit
  }

  const event: InternalEvent = {
    type: "pr.linked",
    bountyId: bounty.id,
    occurredAt: now(deps),
    prNumber: pr.number,
    authorLogin: pr.authorLogin,
    headSha: pr.headSha,
  };
  const r = transition(bounty, event);
  if (!r.ok) return skip("illegal_transition");

  await bounties.saveBounty(r.bounty);
  await bounties.saveSubmission({
    id: `sub-${bounty.id}-${pr.number}`,
    bountyId: bounty.id,
    prNumber: pr.number,
    authorLogin: pr.authorLogin,
    headSha: pr.headSha,
    verdict: null,
    report: null,
    spamScore: null,
    mergedAt: null,
  });
  await deps.bus.publish(event);
  return { kind: "linked", issue, bountyId: bounty.id, headSha: pr.headSha };
}

async function onMerged(pr: PullRequestPayload, issues: number[], deps: PrDeps): Promise<PrOutcome[]> {
  const { bounties } = deps;
  const outcomes: PrOutcome[] = [];
  const candidates = new Map<string, Bounty>();

  for (const issue of issues) {
    const b = await bounties.findByIssue(pr.repo, issue);
    if (b) candidates.set(b.id, b);
    else outcomes.push({ kind: "skipped", issue, reason: "no_bounty" });
  }
  // Linked earlier but "Fixes #n" removed from the body before merging: still counts.
  for (const s of await bounties.submissionsForPr(pr.repo, pr.number)) {
    const b = candidates.has(s.bountyId) ? undefined : await bounties.findById(s.bountyId);
    if (b) candidates.set(b.id, b);
  }
  // No link at all: the author's own claimed bounties in this repo are the likely target.
  if (candidates.size === 0) {
    for (const b of await bounties.openBountiesClaimedBy(pr.repo, pr.authorLogin)) candidates.set(b.id, b);
  }

  for (const bounty of candidates.values()) {
    outcomes.push(await mergeOne(pr, bounty, deps));
  }
  return outcomes;
}

async function mergeOne(pr: PullRequestPayload, bounty: Bounty, deps: PrDeps): Promise<PrOutcome> {
  const { bounties } = deps;
  const issue = bounty.issueNumber;
  const skip = (reason: SkipReason): PrOutcome => ({ kind: "skipped", issue, bountyId: bounty.id, reason });

  if (bounty.status === "unfunded") return skip("unfunded");
  if (bounty.status === "funded") return skip("unclaimed");
  if (bounty.status !== "claimed" && bounty.status !== "submitted") return skip("not_open");

  const current = await bounties.currentSubmission(bounty.id);
  if (bounty.status !== "submitted" || current?.prNumber !== pr.number) {
    const claimant = await bounties.activeClaimant(bounty.id);
    await deps.notifier.comment(
      { repo: pr.repo, issueNumber: issue, installationId: pr.installationId },
      missingLinkMessage(issue, pr.number, pr.authorLogin, claimant?.login ?? null),
    );
    return { kind: "asked_maintainer", issue, bountyId: bounty.id };
  }

  const ciGreen = await deps.ci.isGreen({ repo: pr.repo, sha: pr.headSha, installationId: pr.installationId });
  const occurredAt = pr.mergedAt ?? now(deps);
  const event: InternalEvent = {
    type: "pr.merged",
    bountyId: bounty.id,
    occurredAt,
    prNumber: pr.number,
    ciGreen,
    mergeSha: pr.mergeCommitSha ?? undefined,
    authorLogin: pr.authorLogin,
    mergedByLogin: pr.mergedBy ?? undefined,
  };
  const r = transition(bounty, event);
  if (!r.ok) return skip("illegal_transition");

  await bounties.saveBounty(r.bounty);
  await bounties.saveSubmission({ ...current, mergedAt: occurredAt });
  await deps.bus.publish(event);
  return { kind: "merged", issue, bountyId: bounty.id, to: r.to, ciGreen };
}

function now(deps: PrDeps): string {
  return (deps.now?.() ?? new Date()).toISOString();
}

/** Registers the PR handlers on the webhook dispatcher. */
export function registerPrHandlers(dispatcher: GithubDispatcher, deps: PrDeps): GithubDispatcher {
  return dispatcher.on("pull_request", async (e) => {
    const pr = parsePullRequestPayload(e.payload);
    if (!pr) return;
    const { outcomes, crossRepo } = await handlePullRequest(pr, deps);
    if (outcomes.length || crossRepo.length) {
      console.log(`[pr] ${pr.repo}#${pr.number} ${pr.action}`, JSON.stringify({ outcomes, crossRepo }));
    }
  });
}

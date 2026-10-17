import type { Criterion } from "@bitbounty/core";
import type { BountyRepo, EventBus } from "../../github/pr/ports.js";
import type { VerifyCi, VerifyIssue } from "../verifier/index.js";

/** The check name maintainers see on the PR (docs/plan.md §5, same constant G4 skips for `ciGreen`). */
export const CHECK_NAME = "BitBounty verification";

/** GitHub's check run conclusions we use. */
export type CheckConclusion = "success" | "failure" | "neutral" | "skipped";

/** The PR fields A2 needs, parsed from the `pull_request` webhook payload. */
export interface PrRef {
  repo: string;
  installationId: number;
  number: number;
  headSha: string;
  title: string;
  body: string | null;
  authorLogin: string;
}

/** A funded bounty a PR is linked to, with what the verifier needs. */
export interface LinkedBounty {
  bountyId: string;
  issueNumber: number;
  issue: VerifyIssue;
  criteria: Criterion[];
}

/**
 * "Is this PR linked to a funded bounty, and what are its criteria?"
 * Kept small on purpose: G4 owns PR linking and F3 owns storage; A2 only asks.
 */
export interface BountyLookup {
  findForPr(pr: PrRef): Promise<LinkedBounty | undefined>;
}

/** G4's ports: A2 reads bounties from its repo and emits `verify.done` on the shared bus. */
export type { BountyRepo, EventBus };

export interface CheckRunTarget {
  repo: string;
  installationId: number;
}

export interface CheckRunOutput {
  title: string;
  summary: string;
}

/** Everything A2 reads from or writes to GitHub. Fake in `fakes.ts`, Octokit in `octokit.ts`. */
export interface CheckRunGithub {
  /** Creates the check run `in_progress` on `headSha`, returns its id. */
  createCheckRun(t: CheckRunTarget, headSha: string, output: CheckRunOutput): Promise<number>;
  completeCheckRun(
    t: CheckRunTarget,
    checkRunId: number,
    conclusion: CheckConclusion,
    output: CheckRunOutput,
  ): Promise<void>;
  /** Unified diff of the PR (`application/vnd.github.diff`). */
  getPrDiff(t: CheckRunTarget, prNumber: number): Promise<string>;
  /** Current head SHA of the PR, to detect a newer push. */
  getPrHeadSha(t: CheckRunTarget, prNumber: number): Promise<string>;
  /** CI state of a commit, our own check excluded. Never throws: `unknown` on error. */
  getCiStatus(t: CheckRunTarget, sha: string): Promise<VerifyCi>;
  /** Issue title and body (used by the demo lookup). */
  getIssue(t: CheckRunTarget, issueNumber: number): Promise<{ title: string; body: string }>;
}

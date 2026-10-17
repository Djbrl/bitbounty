import type { Bounty, EventType, InternalEvent, Submission } from "@bitbounty/core";

/**
 * Everything the PR handlers need from the outside world. Each port has an
 * in-memory fake in `fakes.ts` (tests, offline demo) and, where it talks to
 * GitHub, an Octokit adapter in `octokit.ts`.
 */

/** The developer holding the active claim on a bounty. */
export interface Claimant {
  claimId: string;
  userId: string;
  /** GitHub login, compared case-insensitively with the PR author. */
  login: string;
}

/** Bounty storage. In-memory until F3 lands; then a Drizzle implementation. */
export interface BountyRepo {
  findById(id: string): Promise<Bounty | undefined>;
  findByIssue(repoFullName: string, issueNumber: number): Promise<Bounty | undefined>;
  /** The active claim's holder, if any. */
  activeClaimant(bountyId: string): Promise<Claimant | undefined>;
  /** The submission currently attached to the bounty (latest PR linked). */
  currentSubmission(bountyId: string): Promise<Submission | undefined>;
  /** Submissions for this PR, across all bounties of the repo. */
  submissionsForPr(repoFullName: string, prNumber: number): Promise<Submission[]>;
  /** Bounties of the repo in `claimed` or `submitted` whose active claimant is `login`. */
  openBountiesClaimedBy(repoFullName: string, login: string): Promise<Bounty[]>;
  saveBounty(bounty: Bounty): Promise<void>;
  /** Insert or replace by `id`. */
  saveSubmission(submission: Submission): Promise<void>;
}

export type EventHandler<T extends EventType = EventType> = (
  event: Extract<InternalEvent, { type: T }>,
) => void | Promise<void>;

/** Internal events between modules. In-memory now; pg-boss later, same interface. */
export interface EventBus {
  publish(event: InternalEvent): Promise<void>;
  subscribe<T extends EventType>(type: T, handler: EventHandler<T>): void;
}

export interface CommentTarget {
  repo: string;
  /** Issue or PR number (a PR is an issue for comments). */
  issueNumber: number;
  installationId: number | null;
}

/** Posts bot comments on GitHub. */
export interface PrNotifier {
  comment(target: CommentTarget, body: string): Promise<void>;
}

/** Whether the repo's CI is green on a commit (`pr.merged.ciGreen`). */
export interface CiReader {
  isGreen(target: { repo: string; sha: string; installationId: number | null }): Promise<boolean>;
}

export interface PrDeps {
  bounties: BountyRepo;
  bus: EventBus;
  notifier: PrNotifier;
  ci: CiReader;
  now?: () => Date;
}

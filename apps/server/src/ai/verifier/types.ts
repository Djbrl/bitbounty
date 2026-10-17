import type { Criterion, VerificationReport, Verdict } from "@bitbounty/core";

export type { Criterion, VerificationReport, Verdict };

/** The issue the bounty is attached to. Untrusted: anyone can write an issue. */
export interface VerifyIssue {
  title: string;
  body: string;
}

/** CI state of the PR's head commit, as A2/G4 read it from GitHub checks. */
export interface VerifyCi {
  status: "success" | "failure" | "pending" | "unknown";
  /** Optional one-liners, e.g. "test (ubuntu): success". */
  checks?: string[];
}

export interface VerifyInput {
  issue: VerifyIssue;
  criteria: Criterion[];
  /** Unified diff of the PR (`git diff` / GitHub `.diff`). Untrusted. */
  diff: string;
  ci: VerifyCi;
}

/** What the verifier sends to the model: already-built prompt text. */
export interface VerifierRequest {
  system: string;
  user: string;
  /** JSON schema the answer must follow (used for structured outputs). */
  schema: Record<string, unknown>;
  signal?: AbortSignal;
}

/**
 * The only door to the model. Returns the raw text answer; `verify()` does the
 * parsing and validation, so a broken or lying client can never yield `pass`
 * unless the answer is well-formed and consistent.
 */
export interface VerifierClient {
  readonly name: string;
  /** True for offline/fake clients: the report gets a risk flag saying so. */
  readonly isFake: boolean;
  complete(req: VerifierRequest): Promise<string>;
}

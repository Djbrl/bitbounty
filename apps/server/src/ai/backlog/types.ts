import type { Criterion } from "@bitbounty/core";

/** An open issue as read from GitHub. Untrusted: anyone can write an issue. */
export interface BacklogIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  comments: number;
  /** ISO date, used to prefer recent issues when the backlog is large. */
  updatedAt: string;
}

/** One "Price my backlog" suggestion. Same shape as `BacklogSuggestion` in fixtures/types.ts (W2 page). */
export interface BacklogSuggestion {
  id: string;
  repoFullName: string;
  issueNumber: number;
  issueTitle: string;
  criteria: Criterion[];
  /** What the developer would receive, whole FCFA, already clamped and rounded. */
  priceXof: number;
  reason: string;
  confidence: "high" | "medium" | "low";
  /** Pre-ticked in the UI: high-confidence suggestions only. */
  selected: boolean;
}

export interface BacklogResult {
  repoFullName: string;
  suggestions: BacklogSuggestion[];
  /** Open issues read from GitHub (pull requests excluded). */
  issuesRead: number;
  /** Issues sent to the model (recent first, capped). */
  issuesConsidered: number;
  /** Issues not looked at because of the cap. */
  issuesSkipped: number;
  /** Model or fake that produced the suggestions. */
  model: string;
  isFake: boolean;
  /** Non-fatal problems: a failed batch, invalid answers dropped, injection suspected… */
  warnings: string[];
}

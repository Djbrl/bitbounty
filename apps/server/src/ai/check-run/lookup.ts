import type { BountyStatus, Criterion } from "@bitbounty/core";
import { linkedIssues } from "../../github/pr/linked-issues.js";
import type { BountyLookup, BountyRepo, CheckRunGithub, LinkedBounty, PrRef } from "./types.js";

/** Statuses where the bounty's money is in and a PR may be judged. */
export const VERIFIABLE_STATUSES: readonly BountyStatus[] = ["funded", "claimed", "submitted", "verified"];

/** Issue body for the prompt; the bounty row only stores the title. */
export type IssueBodyReader = (pr: PrRef, issueNumber: number) => Promise<string>;

/**
 * Production lookup on G4's BountyRepo: the first issue the PR closes ("Fixes #n",
 * G4's parser) that has a funded bounty wins.
 */
export class RepoBountyLookup implements BountyLookup {
  constructor(
    private repo: Pick<BountyRepo, "findByIssue">,
    private issueBody: IssueBodyReader = async () => "",
  ) {}

  async findForPr(pr: PrRef): Promise<LinkedBounty | undefined> {
    for (const n of linkedIssues(pr.body, pr.title, pr.repo).issues) {
      const b = await this.repo.findByIssue(pr.repo, n);
      if (!b || !VERIFIABLE_STATUSES.includes(b.status)) continue;
      let body = "";
      try {
        body = await this.issueBody(pr, n);
      } catch {
        // The title and criteria are enough to verify; the body is context.
      }
      // `/bounty` creates bounties without criteria (`/criteria` isn't built yet): fall back to the
      // issue's "Done when" / checklist, otherwise the verifier can only ever answer `unsure`.
      const criteria = b.criteria.length > 0 ? b.criteria : criteriaFromIssueBody(body);
      return { bountyId: b.id, issueNumber: n, issue: { title: b.issueTitle, body }, criteria };
    }
    return undefined;
  }
}

/**
 * Criteria from an issue body: the lines of a "Done when" section if there is one,
 * else its checklist items (`- [ ] …`).
 */
export function criteriaFromIssueBody(body: string): Criterion[] {
  const clean = (s: string) => s.replace(/\*\*|__/g, "").trim();
  const done = /^#{1,6}\s*done when\s*$([\s\S]*?)(?=^#{1,6}\s|(?![\s\S]))/im.exec(body);
  if (done?.[1]) {
    const lines = done[1]
      .split("\n")
      .map((l) => clean(l.replace(/^\s*(?:[-*]\s*(?:\[[ xX]\]\s*)?|\d+\.\s*)/, "")))
      .filter(Boolean);
    if (lines.length) return lines.map((text) => ({ text }));
  }
  return [...body.matchAll(/^\s*[-*]\s*\[[ xX]\]\s+(.+)$/gm)].map((m) => ({ text: clean(m[1]!) }));
}

/**
 * DEMO ONLY (`CHECK_RUN_DEMO_LOOKUP=issue`): until F3 stores real bounties, treat any
 * issue the PR closes as funded and read its criteria from the issue body.
 */
export class IssueDemoLookup implements BountyLookup {
  constructor(private github: Pick<CheckRunGithub, "getIssue">) {}

  async findForPr(pr: PrRef): Promise<LinkedBounty | undefined> {
    const [n] = linkedIssues(pr.body, pr.title, pr.repo).issues;
    if (n === undefined) return undefined;
    const issue = await this.github.getIssue(pr, n);
    return { bountyId: `demo-${pr.repo}#${n}`, issueNumber: n, issue, criteria: criteriaFromIssueBody(issue.body) };
  }
}

/** Tries each lookup in order. */
export class FirstMatchLookup implements BountyLookup {
  constructor(private lookups: BountyLookup[]) {}
  async findForPr(pr: PrRef): Promise<LinkedBounty | undefined> {
    for (const l of this.lookups) {
      const found = await l.findForPr(pr);
      if (found) return found;
    }
    return undefined;
  }
}

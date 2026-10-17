import { describe, expect, it } from "vitest";
import { claimExpiry, FailureWorld, labelFor, PAYOUT_RETRY_EVENTS, payoutRetry } from "../src/e2e/failure-paths.js";
import { renderStatusComment } from "../src/github/status-comment/index.js";

describe("I3: failure paths (real modules, fake GitHub and Bitnob)", () => {
  it("payout: Bitnob reports expired → payout_failed shown with the reason → retried → paid", async () => {
    const lines: string[] = [];
    const world = new FailureWorld({ claimTtlMs: 60_000, retryDelayMs: 150, log: (l) => lines.push(l) });
    await world.start();
    try {
      const r = await payoutRetry(world);
      expect(r.steps.every((s) => s.ok)).toBe(true);
      expect(r.steps.map((s) => s.status)).toEqual(["unfunded", "funded", "claimed", "submitted", "paying", "payout_failed", "paying", "paid"]);
      const failed = r.steps.find((s) => s.status === "payout_failed")!;
      expect(failed.github).toMatch(/Payout failed/);
      expect(failed.comment).toMatch(/didn't go through\. The money stays reserved for them/);
      expect(failed.comment).toMatch(/Last error \(attempt 1\): Bitnob reported expired/);
      expect(failed.comment).toMatch(/We retry automatically/);
      for (const s of r.steps) expect(s.comment).not.toMatch(/Nobody can claim|\/criteria ok/);
      // the payout part of the event stream, in order
      expect(r.events.filter((e) => e.startsWith("payout."))).toEqual(PAYOUT_RETRY_EVENTS);
      expect(r.labels).toContain(labelFor("paid").name);
      expect(r.statusComment).toMatch(/Paid/);
      // the web (I1 read API): same story on the bounty page
      expect(r.web.status).toBe("paid");
      expect(r.web.payout).toEqual({ status: "succeeded", attempts: 2 });
      const page = (await (await world.app.request(`/api/bounties/${r.bountyId}`)).json()) as { claims: { status: string }[]; submission: { verdict: string; ci: string } };
      expect(page.claims.map((c) => c.status)).toEqual(["done"]);
      expect(page.submission).toMatchObject({ verdict: "pass", ci: "success" });
      expect(r.web.timeline).toEqual(expect.arrayContaining(["payout.failed", "payout.succeeded"]));
      const t = r.web.timeline;
      expect(t.indexOf("payout.failed")).toBeLessThan(t.lastIndexOf("payout.started"));
    } finally {
      world.stop();
    }
  });

  it("claim: no PR before the deadline → claim expired, unassigned, note posted, claimable again", async () => {
    const world = new FailureWorld({ claimTtlMs: 150 });
    await world.start();
    try {
      const r = await claimExpiry(world);
      expect(r.steps.every((s) => s.ok)).toBe(true);
      expect(r.steps.map((s) => s.status)).toEqual(["unfunded", "funded", "claimed", "funded", "claimed"]);
      expect(r.events).toEqual(["bounty.created", "funding.paid", "claim.created", "claim.expired", "claim.created"]);
      expect(r.notes.some((n) => /awa-dev.*claim expired without a PR/.test(n))).toBe(true);
      expect(r.statusComment).toMatch(/moussa-dev/);
      const expired = r.steps[3]!;
      expect(expired.comment).not.toMatch(/awa-dev is on it/);
      expect(expired.comment).toMatch(/Funded/);
      expect(expired.comment).toMatch(/comment `\/claim` to take it/);
      for (const s of r.steps) expect(s.comment).not.toMatch(/Nobody can claim|\/criteria ok/);
      expect(r.web.status).toBe("claimed");
      expect(r.web.timeline).toEqual(expect.arrayContaining(["claim.expired"]));
      expect(r.web.claims).toBe(1);
    } finally {
      world.stop();
    }
  });

  it("after the last attempt, the comment stops promising a retry", () => {
    const b = {
      id: "b1", repoFullName: "a/b", issueNumber: 1, issueTitle: "t", amountXof: 5000, status: "payout_failed" as const,
      criteria: [], funderKind: "human" as const, funderId: "github:f", verdict: "pass" as const, statusCommentId: null,
      createdAt: "2026-10-17T20:00:00Z", expiresAt: null,
    };
    const retrying = renderStatusComment(b, { baseUrl: "https://x", pr: { number: 2, authorLogin: "awa" }, payout: { attempts: 1, lastError: "expired" } }, "en");
    const final = renderStatusComment(b, { baseUrl: "https://x", pr: { number: 2, authorLogin: "awa" }, payout: { attempts: 3, lastError: "expired", final: true } }, "en");
    expect(retrying).toMatch(/We retry automatically/);
    expect(final).not.toMatch(/We retry automatically/);
    expect(final).toMatch(/No more automatic retries/);
  });
});

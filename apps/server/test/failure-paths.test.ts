import { describe, expect, it } from "vitest";
import { claimExpiry, FailureWorld, labelFor, PAYOUT_RETRY_EVENTS, payoutRetry } from "../src/e2e/failure-paths.js";
import { renderStatusComment } from "../src/github/status-comment/index.js";
import { statusExtras } from "../src/settlement/status-extras.js";

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
      expect(failed.comment).toMatch(/Last error \(attempt 1\): Bitnob reported the payment expired/);
      expect(failed.comment).toMatch(/\*\*Next:\*\* nothing to do\. We retry automatically\./);
      // A Bitnob expiry is not the developer's payout account.
      expect(failed.comment).not.toMatch(/payout account/);
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
      // The demo keeps serving after world.stop(): the second claim must not expire behind it.
      await new Promise((res) => setTimeout(res, 450));
      expect((await world.repo.findById(r.bountyId))?.status).toBe("claimed");
      expect(world.notes(r.repo, 3, null).filter((n) => n.includes("expired"))).toHaveLength(1);
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
    const render = (payout: Parameters<typeof renderStatusComment>[1]["payout"], lang: "en" | "fr" = "en") =>
      renderStatusComment(b, { baseUrl: "https://x", pr: { number: 2, authorLogin: "awa" }, payout }, lang);
    const retrying = render({ attempts: 1, reason: "expired" });
    const final = render({ attempts: 3, reason: "expired", final: true });
    expect(retrying).toMatch(/We retry automatically/);
    expect(final).not.toMatch(/We retry automatically/);
    expect(final).toMatch(/no more automatic retries/i);
    // No manual retry exists: don't promise one. The payout account is only mentioned when it's the cause.
    for (const c of [retrying, final, render({ attempts: 3, reason: "unreachable", final: true }, "fr")]) {
      expect(c).not.toMatch(/retries once|relance une fois/);
      expect(c).not.toMatch(/payout account|compte de paiement/);
    }
    const noAccount = render({ attempts: 1, reason: "no_account", final: true });
    expect(noAccount).toMatch(/Last error \(attempt 1\): the developer hasn't set a payout account yet/);
    expect(noAccount).toMatch(/@awa, check the Lightning Address on your payout account at https:\/\/x\/me/);
    expect(noAccount).toMatch(/No more automatic retries/);
  });

  it("the public status comment shows a short reason, never the raw payout error", async () => {
    const raw: [string, string][] = [
      ["quote: GET /api/payouts: network error (fetch failed: ECONNREFUSED api.bitnob.co)", "Bitnob didn't answer"],
      ["finalize: POST /api/payouts/finalize: timed out; Bitnob has no payout po_1", "Bitnob didn't answer"],
      ["Bitnob reported expired", "Bitnob reported the payment expired"],
      ["quote expired before initialize", "Bitnob reported the payment expired"],
      ["initialize: no payout account for @x (set it in PAYOUT_ACCOUNTS until W4 onboarding is wired)", "the developer hasn't set a payout account yet"],
      ["initialize: no Bitnob bank_code for wave in SN: … BITNOB_SN_BANK_CODES has no \"wave\" entry", "a payout setup problem on BitBounty's side"],
      ["quote: POST /api/payouts/quote failed: 401 UNAUTHORIZED (check BITNOB_CLIENT_ID / BITNOB_CLIENT_SECRET and the machine clock)", "a payout setup problem on BitBounty's side"],
      ["initialize: POST /api/payouts/initialize failed: 422 VALIDATION: account_number invalid", "Bitnob refused the payment"],
      ["Bitnob reported failed", "Bitnob refused the payment"],
      ["something odd", "the payment didn't complete"],
      // B6: Lightning payouts
      ["lnurl unreachable: aw***@blink.sv: LNURL server timed out after 10000 ms", "the developer's Lightning wallet didn't answer"],
      ["lnurl unreachable: aw***@blink.sv: LNURL server answered 502 with non-JSON", "the developer's Lightning wallet didn't answer"],
      ["lnurl refused: aw***@blink.sv: invoice is for 409000 msat, we asked 408000 msat", "the developer's Lightning Address can't receive this payment"],
      ["lnurl refused: aw***@blink.sv accepts at least 10000000 msat, the payout is 408000 msat", "the developer's Lightning Address can't receive this payment"],
      ["payout account: @awa has no Lightning Address (mobile money payouts are gone: add \"lightningAddress\" in PAYOUT_ACCOUNTS)", "the developer hasn't set a payout account yet"],
      ["pay: POST /api/lightning/pay failed: 403 FEATURE_NOT_ENABLED: The Lightning withdrawals feature is currently not available.", "a payout setup problem on BitBounty's side"],
      ["pay: POST /api/lightning/pay failed: 422 INSUFFICIENT_BALANCE: not enough sats", "Bitnob refused the payment"],
      ["pay: POST /api/lightning/pay: timed out (outcome unknown, polling)", "Bitnob didn't answer"],
      ["invoice expired before it was sent", "Bitnob reported the payment expired"],
    ];
    const b = {
      id: "b1", repoFullName: "a/b", issueNumber: 1, issueTitle: "t", amountXof: 5000, status: "payout_failed" as const,
      criteria: [], funderKind: "human" as const, funderId: "github:f", verdict: "pass" as const, statusCommentId: null,
      createdAt: "2026-10-17T20:00:00Z", expiresAt: null,
    };
    const repo = { activeClaim: async () => undefined, currentSubmission: async () => undefined };
    for (const [lastError, shown] of raw) {
      const payouts = { getByBounty: async () => ({ id: "p1", bitnobPayoutId: null, attempts: 1, status: "failed", lastError }) as never };
      const extras = await statusExtras(b, { repo, payouts });
      expect(extras.payout).not.toHaveProperty("lastError");
      const comment = renderStatusComment(b, { baseUrl: "https://x", ...extras }, "en");
      expect(comment, lastError).toContain(`Last error (attempt 1): ${shown}`);
      expect(comment).not.toMatch(/ECONNREFUSED|api\.bitnob|PAYOUT_ACCOUNTS|BITNOB_|bank_code|422|401|blink\.sv|msat|FEATURE_NOT_ENABLED|lightning\/pay/);
      // B6: an address that can't take the payment is the developer's to fix, like a missing account.
      if (/Lightning Address can|payout account yet/.test(shown)) expect(comment, lastError).toMatch(/check the Lightning Address on your payout account/);
    }
  });
});

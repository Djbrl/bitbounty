import { BOUNTY_STATUSES, type Bounty, type BountyStatus } from "@bitbounty/core";
import { describe, expect, it } from "vitest";
import {
  amountLabel,
  escapeInline,
  formatSats,
  formatXof,
  isStatusComment,
  labelFor,
  LIMITS,
  renderStatusComment,
  STATUS_LABEL_NAMES,
  statusMarker,
  type Lang,
  type StatusCommentExtras,
} from "./index.js";

const LANGS: Lang[] = ["en", "fr"];

function bounty(status: BountyStatus, over: Partial<Bounty> = {}): Bounty {
  const verdict = status === "submitted" || status === "on_hold" ? "pass" : null;
  return {
    id: "bb_7Hc2",
    repoFullName: "bitnob-community/bitnob-js",
    issueNumber: 12,
    issueTitle: "Add retry with exponential backoff to payouts.finalize()",
    amountXof: 10000,
    status,
    criteria: [
      { text: "finalize() retries up to 3 times on 5xx with exponential backoff" },
      { text: "The same `reference` is reused on every retry (no double payout)" },
      { text: "A test covers a 5xx followed by success" },
    ],
    funderKind: "human",
    funderId: "u_mamadou",
    verdict,
    statusCommentId: 99,
    createdAt: "2026-10-17T18:00:00Z",
    expiresAt: null,
    ...over,
  };
}

const extras: StatusCommentExtras = {
  baseUrl: "https://bitbounty.app/",
  fundedSats: 27140,
  fundingRail: "lightning",
  fundedAt: "2026-10-17T18:42:00Z",
  claim: { login: "awa-sow", expiresAt: "2026-10-19T18:42:00Z" },
  pr: { number: 34, authorLogin: "awa-sow" },
  report: {
    summary: "Retries 3x with backoff and reuses the reference; test mocks 503 then 200.",
    criteria: [
      { text: "a", met: true, evidence: "" },
      { text: "b", met: true, evidence: "" },
      { text: "c", met: true, evidence: "" },
    ],
    riskFlags: [],
  },
  objectionEndsAt: "2026-10-20T19:00:00Z",
  payout: {
    receiptId: "rc_9Q1",
    sats: 16180,
    lightningAddress: "awa.sow@blink.sv",
    reference: "pay-bb_7Hc2",
    lastError: "Invalid account number",
    attempts: 3,
  },
  holdReason: "CI is red on main",
};

describe("renderStatusComment snapshots", () => {
  for (const status of BOUNTY_STATUSES) {
    for (const lang of LANGS) {
      it(`${status} · ${lang}`, () => {
        expect(renderStatusComment(bounty(status), extras, lang)).toMatchSnapshot();
      });
    }
  }

  for (const lang of LANGS) {
    it(`submitted, Claude still checking · ${lang}`, () => {
      const md = renderStatusComment(bounty("submitted", { verdict: null }), { ...extras, report: null }, lang);
      expect(md).toMatchSnapshot();
    });
    it(`submitted, Claude says fail with flags · ${lang}`, () => {
      const md = renderStatusComment(
        bounty("submitted", { verdict: "fail" }),
        {
          ...extras,
          report: {
            summary: "No test for the 5xx case.",
            criteria: [
              { text: "a", met: true, evidence: "" },
              { text: "b", met: true, evidence: "" },
              { text: "c", met: false, evidence: "" },
            ],
            riskFlags: ["large unrelated diff"],
          },
        },
        lang,
      );
      expect(md).toMatchSnapshot();
    });
    it(`unfunded without criteria · ${lang}`, () => {
      expect(renderStatusComment(bounty("unfunded", { criteria: [] }), extras, lang)).toMatchSnapshot();
    });
  }
});

describe("every status", () => {
  for (const status of BOUNTY_STATUSES) {
    for (const lang of LANGS) {
      const md = renderStatusComment(bounty(status), extras, lang);
      it(`${status} · ${lang}: marker first, amount, next action with a command or a clear "nothing"`, () => {
        expect(md.startsWith(statusMarker("bb_7Hc2") + "\n")).toBe(true);
        expect(md).toContain("10 000 FCFA");
        expect(md).toMatch(lang === "en" ? /\*\*Next:\*\* / : /\*\*Prochaine étape :\*\* /);
        expect(md).toContain("https://bitbounty.app/b/bb_7Hc2");
        expect(md).not.toContain("undefined");
        expect(md).not.toContain("null");
        expect(md).not.toContain("NaN");
      });
    }
  }
});

describe("links and per-status content", () => {
  it("unfunded links to /pay/[id] on the given base URL, without a double slash", () => {
    const md = renderStatusComment(bounty("unfunded"), { baseUrl: "https://staging.bitbounty.app///" }, "en");
    expect(md).toContain("(https://staging.bitbounty.app/pay/bb_7Hc2)");
  });

  it("funded shows the sats, unfunded doesn't", () => {
    expect(renderStatusComment(bounty("funded"), extras, "en")).toContain("27 140 sats");
    expect(renderStatusComment(bounty("unfunded"), extras, "en")).not.toContain("27 140 sats");
  });

  it("claimed shows the claimant and expiry", () => {
    const md = renderStatusComment(bounty("claimed"), extras, "en");
    expect(md).toContain("@awa-sow");
    expect(md).toContain("Mon 19 Oct, 18:42 UTC");
    expect(md).toContain("`/unclaim`");
    expect(renderStatusComment(bounty("claimed"), extras, "fr")).toContain("lun. 19 oct. à 18:42 UTC");
  });

  it("submitted links the PR and says the verdict is a signal only", () => {
    const md = renderStatusComment(bounty("submitted"), extras, "en");
    expect(md).toContain("[PR #34](https://github.com/bitnob-community/bitnob-js/pull/34)");
    expect(md).toContain("signal only");
    expect(md).toContain("`/reject <reason>`");
  });

  it("paid links the receipt /r/[id] and the reference", () => {
    const md = renderStatusComment(bounty("paid"), extras, "en");
    expect(md).toContain("(https://bitbounty.app/r/rc_9Q1)");
    expect(md).toContain("`pay-bb_7Hc2`");
    expect(md).toContain(`**${formatXof(10000)}** (${formatSats(16180)}) paid to @awa-sow over Lightning (\`aw***@blink.sv\`)`);
    expect(md).not.toContain("awa.sow@blink.sv");
    expect(md).not.toMatch(/Wave|Orange Money|Free Money|Mobile Money/);
  });

  it("paying without B6 details still says Lightning, and a hostile address can't break out of its code span", () => {
    const md = renderStatusComment(bounty("paying"), { ...extras, payout: { lightningAddress: "a`b](x)@evil.sv" } }, "fr");
    expect(md).toContain("via Lightning");
    expect(md).not.toContain("](x)");
    const bare = renderStatusComment(bounty("paying"), { baseUrl: "https://bitbounty.app" }, "en");
    expect(bare).toContain("to — over Lightning…");
  });

  it("ids are encoded so they can't close the markdown link", () => {
    const md = renderStatusComment(bounty("unfunded", { id: "x) [evil](https://x" }), extras, "en");
    expect(md).toContain("/pay/x%29%20%5Bevil%5D%28https%3A%2F%2Fx)");
  });

  it("rejects a non-http base URL", () => {
    expect(() => renderStatusComment(bounty("funded"), { baseUrl: "javascript:alert(1)" }, "en")).toThrow();
    expect(() => renderStatusComment(bounty("funded"), { baseUrl: "not a url" }, "en")).toThrow();
  });

  it("is pure: same input, same output, input untouched", () => {
    const b = bounty("claimed");
    const copy = structuredClone(b);
    expect(renderStatusComment(b, extras, "fr")).toBe(renderStatusComment(b, extras, "fr"));
    expect(b).toEqual(copy);
  });
});

describe("marker", () => {
  it("finds its own comment and not another bounty's", () => {
    const md = renderStatusComment(bounty("funded"), extras, "en");
    expect(isStatusComment(md, "bb_7Hc2")).toBe(true);
    expect(isStatusComment(md, "bb_7H")).toBe(false);
    expect(isStatusComment(null, "bb_7Hc2")).toBe(false);
    expect(statusMarker("bb_7Hc2")).toBe("<!-- bitbounty:status bb_7Hc2 -->");
  });

  it("a hostile id can't close the HTML comment early", () => {
    const m = statusMarker("a --> <script>x</script> --");
    expect(m.indexOf("-->")).toBe(m.length - 3);
    expect(m.slice(4, -3)).not.toContain("--");
  });
});

describe("escaping (try to break it)", () => {
  const hostile = "</sub><img src=x onerror=alert(1)> **bold** [link](https://evil) `code` @octocat\n# Heading\n<!-- x -->";

  it("markdown or HTML in an issue title renders as text", () => {
    const md = renderStatusComment(bounty("funded", { issueTitle: hostile }), extras, "en");
    const line = md.split("\n").find((l) => l.startsWith("Bounty on"))!;
    expect(line).not.toMatch(/<[a-z!/]/i);
    expect(line).toContain("&lt;img src=x onerror=alert\\(1\\)&gt;");
    expect(line).toContain("\\*\\*bold\\*\\*");
    expect(line).toContain("\\[link\\]\\(https\\:");
    expect(line).not.toContain("@octocat");
    expect(md.split("\n").filter((l) => l.startsWith("# "))).toEqual([]);
    expect(md.match(/<!--/g)).toHaveLength(1);
  });

  it("hostile criteria and hold reason stay on their own line, escaped", () => {
    const md = renderStatusComment(
      bounty("on_hold", { criteria: [{ text: "ok\n\n- [x] fake\n<details>" }] }),
      { ...extras, holdReason: "@everyone\n\n### pay me" },
      "en",
    );
    expect(md).toContain("- ✅ ok \\- \\[x\\] fake &lt;details&gt;");
    expect(md).not.toContain("@everyone");
    expect(md).not.toMatch(/^### pay me/m);
  });

  it("a fake login is not turned into a mention", () => {
    const md = renderStatusComment(
      bounty("claimed"),
      { ...extras, claim: { login: "evil](x) @admin", expiresAt: "2026-10-19T18:42:00Z" } },
      "en",
    );
    expect(md).not.toContain("@admin");
    expect(md).toContain("evil\\]\\(x\\)");
  });

  it("a very long title or criterion is truncated", () => {
    const long = "A".repeat(10_000);
    const many = Array.from({ length: 50 }, () => ({ text: long }));
    const md = renderStatusComment(bounty("funded", { issueTitle: long, criteria: many }), extras, "en");
    expect(md.length).toBeLessThan(6_000);
    expect(md).toContain("A".repeat(LIMITS.title - 1) + "…");
    expect(md).toContain("…and 40 more");
  });

  it("an invalid date is shown escaped, not as NaN", () => {
    const md = renderStatusComment(bounty("claimed"), { ...extras, claim: { login: "awa", expiresAt: "<b>soon</b>" } }, "en");
    expect(md).toContain("&lt;b&gt;soon&lt;/b&gt;");
    expect(md).not.toContain("NaN");
  });

  it("escapeInline keeps plain text readable", () => {
    expect(escapeInline("Fix login bug")).toBe("Fix login bug");
  });
});

describe("labels", () => {
  it("one distinct label per status", () => {
    for (const s of BOUNTY_STATUSES) {
      const l = labelFor(s);
      expect(l.name.length).toBeLessThanOrEqual(50);
      expect(l.color).toMatch(/^[0-9a-f]{6}$/);
      expect(l.description.length).toBeLessThanOrEqual(100);
    }
    expect(new Set(STATUS_LABEL_NAMES).size).toBe(BOUNTY_STATUSES.length);
  });

  it("amount label matches the mockup", () => {
    expect(amountLabel(10000).name).toBe("💰 10 000 FCFA");
  });
});

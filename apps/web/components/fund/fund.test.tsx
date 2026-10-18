import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import funding from "../../../../fixtures/funding.json";
import type { BountyStatus, FundingSession } from "./data";
import { getFundBounty } from "./data";
import { formatCountdown, formatNaira, formatUsdt, groupAccountNumber, msLeft, sourceAmount, summaryLines } from "./format";
import { FundView, fundOutcome, payState, type FundOutcome } from "./fund-view";
import { encodeQr, qrPath } from "./qr";
import { QrCode } from "./qr-code";
import { errorMessage, fundReducer, initialFundState, needsSession } from "./state";
import { SummaryCard } from "./summary-card";

const ln = funding.lightning as FundingSession;
const usdt = funding.usdt as FundingSession;
const ngn = funding.ngn as FundingSession;

// Reference: `qrcode` npm, byte mode, ECC M, mask 4 (also what our mask scoring picks).
const HELLO_M = [
  "111111101101001111111",
  "100000100110101000001",
  "101110100111101011101",
  "101110101001001011101",
  "101110101000101011101",
  "100000101011001000001",
  "111111101010101111111",
  "000000001111100000000",
  "100010111111011111001",
  "000111001011100101111",
  "101100101011001110010",
  "111001000100011010000",
  "001011100100111000110",
  "000000001110111001011",
  "111111101100110001010",
  "100000100001100100010",
  "101110101001001110101",
  "101110100001100001011",
  "101110100111001111000",
  "100000100100011000000",
  "111111101000111110101",
];
/** formatXof/formatSats use no-break spaces; compare with plain spaces. */
const sp = (s: string) => s.replace(/[\u202f\u00a0]/g, " ");
const rows = (m: boolean[][]) => m.map((r) => r.map((c) => (c ? "1" : "0")).join(""));

describe("qr encoder", () => {
  it("matches the reference encoder bit for bit", () => {
    expect(rows(encodeQr("HELLO", "M", 4))).toEqual(HELLO_M);
    expect(rows(encodeQr("HELLO", "M"))).toEqual(HELLO_M);
  });

  it("picks the smallest version that fits (fixture invoice: 91 bytes → version 6, 41×41)", () => {
    expect(encodeQr((ln as { invoice: string }).invoice, "M")).toHaveLength(41);
    // a real-size BOLT11 invoice (~300 chars) needs version 11+ and includes version info blocks
    expect(encodeQr("lnbc".padEnd(300, "q"), "M").length).toBeGreaterThanOrEqual(61);
  });

  it("draws the three finder patterns and refuses data beyond version 40", () => {
    const m = encodeQr("bitbounty");
    const n = m.length;
    for (const [x, y] of [[0, 0], [n - 7, 0], [0, n - 7]] as const) {
      expect(m[y]!.slice(x, x + 7).every(Boolean)).toBe(true);
      expect(m[y + 1]![x + 1]).toBe(false);
      expect(m[y + 3]![x + 3]).toBe(true);
    }
    expect(() => encodeQr("x".repeat(3000))).toThrow(RangeError);
    expect(qrPath([[true, false]], 1)).toBe("M1 1h1v1h-1z");
  });
});

describe("format", () => {
  it("formats source amounts per rail", () => {
    expect(sp(sourceAmount(ln))).toBe("17 474 sats");
    expect(formatUsdt(19_220_000)).toBe("19.22 USDT");
    expect(formatUsdt(1_234_560_001)).toBe("1,234.57 USDT");
    expect(formatNaira(2_900_000)).toBe("₦29,000");
    expect(sourceAmount(ngn)).toBe("₦29,000");
    expect(groupAccountNumber("9930481276")).toBe("993 048 1276");
  });

  it("counts down and never goes negative", () => {
    const exp = "2026-10-17T15:20:00Z";
    expect(formatCountdown(msLeft(exp, Date.parse("2026-10-17T15:05:00Z")))).toBe("15:00");
    expect(formatCountdown(msLeft(exp, Date.parse("2026-10-17T15:05:39Z")))).toBe("14:21");
    expect(formatCountdown(msLeft(exp, Date.parse("2026-10-17T15:30:00Z")))).toBe("00:00");
  });

  it("builds the summary with FCFA and sats", () => {
    const { lines, total } = summaryLines(ln, 17474);
    expect(lines.map((l) => sp(l.value))).toEqual(["10 000 F", "500 F", "300 F"]);
    expect(sp(total)).toBe("10 800 F · 17 474 sats");
    expect(sp(summaryLines(usdt, 17474).total)).toBe("10 800 F · 17 474 sats · 19.22 USDT");
    expect(summaryLines(null, null).total).toBe("—");
  });
});

describe("fund state", () => {
  const T0 = Date.parse("2026-10-17T15:05:00Z");

  it("asks for a session, keeps one per rail, and remembers the sats", () => {
    let s = initialFundState(false);
    expect(needsSession(s, T0)).toBe(true);
    s = fundReducer(s, { type: "request", rail: "lightning" });
    expect(needsSession(s, T0)).toBe(false);
    s = fundReducer(s, { type: "session", session: ln });
    expect(s.sats).toBe(17474);
    s = fundReducer(s, { type: "select", rail: "usdt" });
    expect(needsSession(s, T0)).toBe(true);
    s = fundReducer(s, { type: "session", session: usdt });
    expect(s.sats).toBe(17474);
    expect(needsSession(fundReducer(s, { type: "select", rail: "lightning" }), T0)).toBe(false);
  });

  it("refreshes an expired session, stops on error until retry", () => {
    let s = fundReducer(initialFundState(false), { type: "session", session: ln });
    expect(needsSession(s, Date.parse("2026-10-17T15:20:00Z"))).toBe(true);
    s = fundReducer(s, { type: "error", rail: "lightning", error: "boom" });
    expect(needsSession(s, Date.parse("2026-10-17T15:20:00Z"))).toBe(false);
    s = fundReducer(s, { type: "select", rail: "lightning" });
    expect(s.error).toBeNull();
  });

  it("says funding is not configured on a 503 funding_not_configured, keeps the network message otherwise", () => {
    const notConfigured = errorMessage("funding_not_configured");
    expect(notConfigured).toContain("not set up on this server");
    expect(notConfigured).not.toContain("Could not reach");
    expect(errorMessage("server_unreachable")).toContain("Could not reach BitBounty");
    expect(errorMessage("request_failed")).toContain("Could not reach BitBounty");
  });

  it("switches to funded and stays there", () => {
    let s = fundReducer(initialFundState(false), { type: "paid" });
    expect(s.phase).toBe("funded");
    s = fundReducer(s, { type: "select", rail: "ngn" });
    expect(s.rail).toBe("lightning");
    expect(needsSession(s, T0)).toBe(false);
    expect(initialFundState(true).phase).toBe("funded");
  });
});

describe("fund page", () => {
  it("loads the bounty from the fixtures", () => {
    expect(getFundBounty("b-101")).toMatchObject({ id: "b-101", status: "unfunded", amountXof: 15000 });
    expect(getFundBounty("nope")).toBeNull();
  });

  it("loads a bounty created from the dashboard backlog (Fund N bounties)", () => {
    expect(getFundBounty("b-sug-1")).toMatchObject({
      id: "b-sug-1",
      status: "unfunded",
      amountXof: 7500,
      repoFullName: "teranga-labs/bitnob-js",
      issueNumber: 25,
      funderLogin: "Djbrl",
    });
  });

  it("renders the three tabs and the summary for an unfunded bounty", () => {
    const html = sp(renderToStaticMarkup(<FundView bounty={getFundBounty("b-101")!} />));
    expect(html).toContain("Fund this bounty");
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    for (const t of ["Lightning", "USDT", "Bank transfer", "You pay", "teranga-labs/bitnob-js #21"]) expect(html).toContain(t);
  });

  it("renders the funded state for a funded bounty", () => {
    const html = renderToStaticMarkup(<FundView bounty={getFundBounty("b-102")!} />);
    expect(html).toContain("Funded");
    expect(html).not.toContain('role="tab"');
    expect(html).toContain('data-pay-state="paid"');
  });

  describe("only claims what is true for each status (CR6)", () => {
    const render = (status: BountyStatus) =>
      sp(renderToStaticMarkup(<FundView bounty={{ ...getFundBounty("b-102")!, status }} />));
    const CLAIM = "anyone can now";

    it("maps every status to an outcome", () => {
      const expected: Record<BountyStatus, FundOutcome> = {
        unfunded: "open",
        funded: "open",
        claimed: "in_progress",
        submitted: "in_progress",
        verified: "in_progress",
        paying: "in_progress",
        on_hold: "in_progress",
        payout_failed: "in_progress",
        paid: "paid",
        cancelled: "cancelled",
        refunded: "refunded",
      };
      for (const [status, outcome] of Object.entries(expected)) expect(fundOutcome(status as BountyStatus)).toBe(outcome);
    });

    it("funded: held by Bitnob and open to /claim", () => {
      const html = render("funded");
      expect(html).toContain("held by Bitnob");
      expect(html).toContain(CLAIM);
      expect(html).toContain("Bounty funded");
    });

    it.each(["claimed", "submitted", "verified", "paying", "on_hold", "payout_failed"] as const)(
      "%s: held by Bitnob, no /claim",
      (status) => {
        const html = render(status);
        expect(html).toContain("held by Bitnob");
        expect(html).toContain("already working on it");
        expect(html).not.toContain(CLAIM);
      },
    );

    it.each([
      ["paid", "Prime payée", 'data-pay-state="paid"'],
      ["cancelled", "Prime annulée", 'data-pay-state="closed"'],
      ["refunded", "Prime remboursée", 'data-pay-state="closed"'],
    ] as const)("%s: short French message and a link to the bounty", (status, title, pill) => {
      const html = render(status);
      expect(html).toContain(title);
      expect(html).toContain(pill);
      expect(html).toContain('href="/b/b-102"');
      expect(html).toContain("Voir la prime");
      expect(html).not.toContain("is held by Bitnob");
      expect(html).not.toContain("/claim");
      expect(html).not.toContain("Bounty funded");
      expect(html).not.toContain('role="tab"');
    });
  });

  it("shows one clear state: preparing, waiting, expired, error, paid (U5)", () => {
    const exp = new Date(ln.expiresAt).getTime();
    expect(payState("paying", null, null, null)).toBe("preparing");
    expect(payState("paying", null, ln, exp - 1000)).toBe("waiting");
    expect(payState("paying", null, ln, exp + 1000)).toBe("expired");
    expect(payState("paying", "boom", ln, exp - 1000)).toBe("error");
    expect(payState("funded", null, ln, exp + 1000)).toBe("paid");
    expect(renderToStaticMarkup(<FundView bounty={getFundBounty("b-101")!} />)).toContain('data-pay-state="preparing"');
  });

  it("renders a scannable QR and the summary card", () => {
    const qr = renderToStaticMarkup(<QrCode value="HELLO" label="QR" />);
    expect(qr).toContain('data-qr-size="21"');
    const card = sp(renderToStaticMarkup(<SummaryCard bounty={getFundBounty("b-101")!} session={ln} sats={17474} />));
    expect(card).toContain("10 800 F · 17 474 sats");
  });
});

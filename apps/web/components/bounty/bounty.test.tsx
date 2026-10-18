import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BountyView } from "./bounty-view";
import { bountyIds, getBounty, getReceipt, receiptIdForBounty, receiptIds } from "./data";
import { ReceiptView } from "./receipt-view";
import {
  criteriaScore,
  formatDateTime,
  formatDuration,
  formatSource,
  mergeToPaidMinutes,
  progressSteps,
  receiptRows,
  wasRejected,
  xofToEur,
} from "./shape";

const must = async (id: string) => {
  const b = await getBounty(id);
  if (!b) throw new Error(`fixture ${id} missing`);
  return b;
};

describe("data", () => {
  it("returns null for unknown ids (page renders 404)", async () => {
    expect(await getBounty("b-999")).toBeNull();
    expect(await getReceipt("r-999")).toBeNull();
  });

  it("lists every fixture id for static params", () => {
    expect(bountyIds()).toHaveLength(14);
    expect(receiptIds().sort()).toEqual(["r-107", "r-113"]);
  });

  it("links paid bounties to their receipt", async () => {
    expect(await receiptIdForBounty("b-107")).toBe("r-107");
    expect(await receiptIdForBounty("b-113")).toBe("r-113");
    expect(await receiptIdForBounty("b-101")).toBeNull();
  });
});

describe("shape", () => {
  it("formats UTC (= Dakar) times without Intl", () => {
    expect(formatDateTime("2026-10-17T18:26:00Z")).toBe("17 Oct, 18:26");
    expect(formatDateTime("2026-10-18T01:05:00Z", "fr")).toBe("18 oct., 01:05");
    expect(formatDuration(6)).toBe("6 min");
    expect(formatDuration(95)).toBe("1 h 35 min");
    expect(formatDuration(120)).toBe("2 h");
  });

  it("formats funding sources in their own unit", () => {
    expect(formatSource("lightning", 17474)).toBe("17 474 sats");
    expect(formatSource("ngn", 2_900_000)).toBe("₦29 000");
    expect(formatSource("usdt", 16_500_000)).toBe("16.50 USDT");
    expect(xofToEur(10_000)).toBe("≈ €15.24");
  });

  it("derives progress, score and merge-to-paid for the happy path (b-107)", async () => {
    const b = await must("b-107");
    expect(progressSteps(b).map((s) => s.done)).toEqual([true, true, true, true, true]);
    expect(criteriaScore(b)).toEqual({ met: 3, total: 3 });
    expect(mergeToPaidMinutes(b)).toBe(6);
  });

  it("handles early and failed stages", async () => {
    const unfunded = await must("b-101");
    expect(progressSteps(unfunded).every((s) => !s.done)).toBe(true);
    expect(criteriaScore(unfunded)).toBeNull();
    expect(mergeToPaidMinutes(unfunded)).toBeNull();
    expect(criteriaScore(await must("b-104"))).toEqual({ met: 2, total: 3 });
    expect(wasRejected(await must("b-102"))).toBe(true);
    expect(wasRejected(await must("b-104"))).toBe(false);
  });

  it("builds receipt rows with amount source, Lightning Address, sats and speed", async () => {
    const r = await getReceipt("r-113");
    const rows = Object.fromEntries(receiptRows(r!).map((x) => [x.key, x.value]));
    expect(rows.to).toBe("Lightning · fa***@blink.sv");
    expect(rows.sats).toBe("16 180 sats");
    expect(rows.speed).toBe("5 min");
    expect(rows.funded).toContain("₦29 000");
  });
});

describe("render", () => {
  it.each(bountyIds())("renders /b/%s with its status and every timeline event", async (id) => {
    const b = await must(id);
    const html = renderToStaticMarkup(<BountyView b={b} receiptId={await receiptIdForBounty(id)} />);
    expect(html).toContain(`data-status="${b.status}"`);
    expect(html.match(/data-event=/g)?.length).toBe(b.timeline.length);
    if (b.submission?.verdict) expect(html).toContain(`data-verdict="${b.submission.verdict}"`);
  });

  it("renders the verdict evidence and receipt link on b-107", async () => {
    const html = renderToStaticMarkup(<BountyView b={await must("b-107")} receiptId="r-107" />);
    expect(html).toContain("src/payouts.ts:22-48");
    expect(html).toContain('href="/r/r-107"');
    expect(html).toContain("6 min");
  });

  it("shows the payout error on b-108", async () => {
    const html = renderToStaticMarkup(<BountyView b={await must("b-108")} receiptId={null} />);
    expect(html).toContain("lnurl unreachable");
    expect(html).toContain("mo***@walletofsatoshi.com");
  });

  it("renders a receipt with FCFA, sats, masked Lightning Address and PR link", async () => {
    const html = renderToStaticMarkup(<ReceiptView r={(await getReceipt("r-107"))!} />);
    expect(html).toContain("FCFA");
    expect(html).toContain("17 474 sats");
    expect(html).toContain("Lightning · aw***@blink.sv");
    expect(html).toContain("16 180 sats");
    expect(html).not.toMatch(/Wave|Orange Money|\+221/);
    expect(html).toContain("https://github.com/teranga-labs/bitnob-js/pull/34");
    expect(html).toContain("6 min");
  });
});

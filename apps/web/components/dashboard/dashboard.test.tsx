import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { BacklogSuggestion } from "../../../../fixtures/types";
import { formatXof } from "../ui";
import { BacklogTable, FundBar } from "./backlog-view";
import { getDashboard } from "./data";
import { DashboardView } from "./dashboard-view";
import { fundBacklog } from "./fund";
import {
  activeBounties,
  fundLabel,
  initialSelection,
  initialsOf,
  payHref,
  summarizeSelection,
  toggle,
  toggleAll,
} from "./shape";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const sug = (id: string, priceXof: number, selected = true): BacklogSuggestion => ({
  id,
  repoFullName: "o/r",
  issueNumber: Number(id.replace(/\D/g, "")) || 1,
  issueTitle: `Issue ${id}`,
  criteria: [{ text: "a" }],
  priceXof,
  reason: "why",
  confidence: "high",
  selected,
});

describe("shape", () => {
  it("pre-selects Claude's picks and totals them with the 5% fee", async () => {
    const { backlog } = await getDashboard();
    const ids = initialSelection(backlog);
    expect(ids).toEqual(["sug-1", "sug-2", "sug-3", "sug-4", "sug-5"]);
    expect(summarizeSelection(backlog, ids)).toEqual({ count: 5, amountXof: 40500, feeXof: 2025, totalXof: 42525 });
  });

  it("returns zeros when nothing is selected (0 suggestions or all cleared)", () => {
    expect(summarizeSelection([], [])).toEqual({ count: 0, amountXof: 0, feeXof: 0, totalXof: 0 });
    expect(summarizeSelection([sug("s1", 1000)], [])).toMatchObject({ count: 0, totalXof: 0 });
  });

  it("handles 50 suggestions and ignores unknown ids", () => {
    const many = Array.from({ length: 50 }, (_, i) => sug(`s${i + 1}`, 1000));
    expect(summarizeSelection(many, [...initialSelection(many), "ghost"])).toEqual({
      count: 50,
      amountXof: 50000,
      feeXof: 2500,
      totalXof: 52500,
    });
  });

  it("toggles one id and keeps backlog order", () => {
    const b = [sug("s1", 1), sug("s2", 1), sug("s3", 1)];
    expect(toggle(b, ["s3"], "s1")).toEqual(["s1", "s3"]);
    expect(toggle(b, ["s1", "s3"], "s1")).toEqual(["s3"]);
    expect(toggleAll(b, ["s1"])).toEqual(["s1", "s2", "s3"]);
    expect(toggleAll(b, ["s1", "s2", "s3"])).toEqual([]);
  });

  it("keeps only bounties still in flight", async () => {
    const { bounties } = await getDashboard();
    const statuses = activeBounties(bounties).map((b) => b.status);
    expect(statuses).not.toContain("paid");
    expect(statuses).not.toContain("refunded");
    expect(statuses).not.toContain("cancelled");
    expect(statuses).toContain("claimed");
  });

  it("routes to /pay of the first created bounty, with the batch", () => {
    expect(payHref({ count: 2, suggestions: ["sug-1", "sug-4"], bountyIds: ["b-sug-1", "b-sug-4"] })).toBe(
      "/pay/b-sug-1?batch=b-sug-1,b-sug-4",
    );
    expect(payHref({ count: 1, suggestions: ["sug-2"], bountyIds: ["b-sug-2"] })).toBe("/pay/b-sug-2");
    expect(payHref({ count: 0, suggestions: [], bountyIds: [] })).toBeNull();
  });

  it("labels and initials", () => {
    expect(fundLabel(1)).toBe("Fund 1 bounty");
    expect(fundLabel(4)).toBe("Fund 4 bounties");
    expect(initialsOf("Djbrl")).toBe("DJ");
    expect(initialsOf("--")).toBe("?");
  });
});

describe("fundBacklog", () => {
  it("POSTs the ids to /api/backlog/fund", async () => {
    const fetcher = vi.fn(async () => Response.json({ count: 2, suggestions: ["sug-1", "sug-2"], bountyIds: ["b-sug-1", "b-sug-2"], session: {} }));
    const res = await fundBacklog(["sug-1", "sug-2"], fetcher as unknown as typeof fetch);
    expect(res).toEqual({ count: 2, suggestions: ["sug-1", "sug-2"], bountyIds: ["b-sug-1", "b-sug-2"] });
    expect(fetcher).toHaveBeenCalledWith("/api/backlog/fund", expect.objectContaining({ method: "POST", body: '{"ids":["sug-1","sug-2"]}' }));
  });

  it("throws the API error", async () => {
    const fetcher = vi.fn(async () => Response.json({ error: "nothing_selected" }, { status: 400 }));
    await expect(fundBacklog([], fetcher as unknown as typeof fetch)).rejects.toThrow("nothing_selected");
  });
});

describe("render", () => {
  it("renders the dashboard from fixtures", async () => {
    const html = renderToStaticMarkup(<DashboardView data={await getDashboard()} />);
    expect(html).toContain("Held for open bounties");
    expect(html).toContain(formatXof(60500));
    expect(html).toContain("Price my backlog");
    expect(html).toContain("Fund 5 bounties");
    expect(html).toContain(formatXof(42525));
    expect(html).toContain('data-status="claimed"');
    expect(html).toContain("teranga-labs/xof");
    expect(html).not.toContain('data-bounty="b-107"');
  });

  it("disables the fund button when nothing is selected", () => {
    const html = renderToStaticMarkup(<FundBar summary={{ count: 0, amountXof: 0, feeXof: 0, totalXof: 0 }} />);
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).toContain("Select at least one suggestion");
  });

  it("shows an empty state with 0 suggestions and ticks selected rows", () => {
    expect(renderToStaticMarkup(<BacklogTable backlog={[]} selected={[]} />)).toContain("No suggestions yet");
    const html = renderToStaticMarkup(<BacklogTable backlog={[sug("s1", 1000), sug("s2", 2000, false)]} selected={["s1"]} />);
    expect(html).toContain('aria-selected="true"');
    expect(html.match(/checked=""/g)).toHaveLength(1);
  });
});

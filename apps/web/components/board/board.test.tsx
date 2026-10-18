import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import liveFx from "../../../../fixtures/live.json";
import { BoardView } from "./board-view";
import { getBoard, getIssueIndex, getRecentPayouts } from "./data";
import {
  applyFilter,
  boardFilters,
  displayLabels,
  formatUsd,
  initialLiveState,
  onSnapshot,
  onTransition,
  openBounties,
  type Board,
  type Live,
} from "./shape";

const live = liveFx as unknown as Live;

describe("openBounties", () => {
  it("keeps funded-but-unpaid statuses, claimable first", async () => {
    const board = await getBoard();
    const rows = openBounties(board.bounties);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((b) => b.status === "paid")).toBe(false);
    expect(rows[0]!.status).toBe("funded");
    const firstNonFunded = rows.findIndex((b) => b.status !== "funded");
    expect(rows.slice(firstNonFunded).every((b) => b.status !== "funded")).toBe(true);
  });

  it("handles an empty board", () => {
    expect(openBounties([])).toEqual([]);
  });
});

describe("filters", () => {
  it("builds fixed filters plus one per repo owner, and filters by them", async () => {
    const rows = openBounties((await getBoard()).bounties);
    const filters = boardFilters(rows);
    expect(filters.map((f) => f.id).slice(0, 4)).toEqual(["all", "open", "small", "agent"]);
    expect(filters.some((f) => f.id === "org:teranga-labs")).toBe(true);
    expect(applyFilter(rows, filters, "all")).toHaveLength(rows.length);
    expect(applyFilter(rows, filters, "open").every((b) => b.status === "funded")).toBe(true);
    expect(applyFilter(rows, filters, "small").every((b) => b.amountXof < 10_000)).toBe(true);
    expect(applyFilter(rows, filters, "agent").every((b) => b.funderKind === "agent")).toBe(true);
    expect(applyFilter(rows, filters, "org:teranga-labs").every((b) => b.repoFullName.startsWith("teranga-labs/"))).toBe(true);
  });

  it("returns nothing when no row matches, and falls back to all on an unknown id", async () => {
    const rows = openBounties((await getBoard()).bounties).filter((b) => b.funderKind !== "agent");
    const filters = boardFilters(rows);
    expect(applyFilter(rows, filters, "agent")).toEqual([]);
    expect(applyFilter(rows, filters, "nope")).toHaveLength(rows.length);
  });

  it("drops the generic bounty/amount labels", async () => {
    const b = (await getBoard()).bounties[0]!;
    expect(displayLabels(b).some((l) => l === "bounty" || l.startsWith("💰"))).toBe(false);
  });
});

describe("formatUsd", () => {
  it("formats cents", () => {
    expect(formatUsd(50000)).toBe("$500");
    expect(formatUsd(123456789)).toBe("$1,234,567.89");
  });
});

describe("live payouts", () => {
  it("seeds from succeeded payouts, newest first", async () => {
    const rows = await getRecentPayouts();
    expect(rows.map((r) => r.bountyId)).toEqual(["b-113", "b-107"]);
    expect(rows[1]).toMatchObject({ login: "awa-ndiaye", via: "16 180 sats", amountXof: 10000, issueNumber: expect.any(Number) });
  });

  it("adds a payout.succeeded once per bounty, with the claimer and the sats", async () => {
    const issues = await getIssueIndex();
    let s = onSnapshot(initialLiveState([]), live);
    for (const ev of live.events) s = onTransition(s, ev, issues);
    expect(s.payouts.map((p) => p.bountyId)).toEqual(["b-113", "b-106"]);
    expect(s.payouts[0]).toMatchObject({ login: "fatou-sall", via: "16 180 sats", amountXof: 10000, fresh: true });
    expect(s.payouts[0]!.note).toContain("Lagos");
    expect(s.payouts[1]).toMatchObject({ login: "seynabou-gueye", fresh: false });
    // the stream loops: replaying the events must not duplicate rows
    s = onSnapshot(s, live);
    for (const ev of live.events) s = onTransition(s, ev, issues);
    expect(s.payouts).toHaveLength(2);
  });

  it("ignores events for unknown cards and non-payout events", () => {
    const s0 = initialLiveState([]);
    const s1 = onTransition(s0, { bountyId: "zz", event: "payout.succeeded", to: "paid", text: "x" });
    expect(s1.payouts).toEqual([]);
  });
});

describe("BoardView (explore)", () => {
  it("shows a calm project list: no stat cards, no live column", async () => {
    const board = await getBoard();
    const html = renderToStaticMarkup(<BoardView board={board} lang="en" />);
    expect(html).toContain("Pick a project");
    expect(html).toContain("teranga-labs");
    expect(html).toContain("/explore?repo=teranga-labs%2Fbitnob-js");
    expect(html).not.toContain(`${board.stats.medianMinutesMergeToPay} min`);
    expect(html).not.toContain("Live payouts");
    expect(html).not.toContain("Paid in dollars elsewhere");
    // paid-only repos are not listed
    expect(html).not.toContain("ngn-kit");
  });

  it("drills into one project's open bounties", async () => {
    const board = await getBoard();
    const html = renderToStaticMarkup(<BoardView board={board} lang="en" repo="teranga-labs/bitnob-js" base="/app/explore" inShell />);
    expect(html).toContain("All projects");
    expect(html).toContain('href="/app/explore"');
    const funded = board.bounties.find((b) => b.repoFullName === "teranga-labs/bitnob-js" && b.status === "funded")!;
    expect(html).toContain(funded.issueTitle);
    expect(html).not.toContain(board.bounties.find((b) => b.repoFullName === "teranga-labs/xof")!.issueTitle);
  });

  it("searches issues across projects with q", async () => {
    const board = await getBoard();
    const html = renderToStaticMarkup(<BoardView board={board} lang="fr" q="formatXOF" />);
    expect(html).toContain("Résultats de recherche");
    expect(html).toContain("formatXOF()");
  });

  it("renders the empty state", () => {
    const empty: Board = { stats: { paidCount: 0, paidTotalXof: 0, medianMinutesMergeToPay: 0, developersPaid: 0 }, bounties: [], external: [] };
    const html = renderToStaticMarkup(<BoardView board={empty} lang="en" />);
    expect(html).toContain("No project with open bounties");
  });
});

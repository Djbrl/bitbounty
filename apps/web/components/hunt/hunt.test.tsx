import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import bountiesFx from "../../../../fixtures/bounties.json";
import type { BountyDetail, BountySummary } from "../../../../fixtures/types";
import { getBoard } from "../board/data";
import { TIER_MIN } from "../profile/data";
import { loadHunt, pickStack } from "./data";
import { applyExplore, bountyLanguages, canonicalLanguage, exploreOptions, exploreQuery, inBucket, NO_FILTER, projectSummaries, timeAgo } from "./explore";
import { ProjectGrid } from "./project-grid";
import { ExploreGrid } from "./explore-grid";
import { HuntView } from "./hunt-view";
import { activityFeed, claimCard, claimElapsed, formatCountdown, forYou, tierProgress, weekStreak } from "./shape";

const details = bountiesFx as unknown as BountyDetail[];
const NOW = Date.parse("2026-10-18T12:00:00Z");

const row = (over: Partial<BountySummary>): BountySummary =>
  ({
    id: "x",
    repoFullName: "acme/app",
    issueNumber: 1,
    issueTitle: "Fix",
    amountXof: 5000,
    status: "funded",
    labels: [],
    funderKind: "human",
    updatedAt: "2026-10-17T10:00:00Z",
    createdAt: "2026-10-17T10:00:00Z",
    ...over,
  }) as BountySummary;

describe("tiers (TIER_MIN from the profile)", () => {
  it("counts down to the next tier", () => {
    expect(tierProgress(0)).toMatchObject({ tier: null, next: "bronze", remaining: TIER_MIN.bronze });
    expect(tierProgress(1)).toMatchObject({ tier: "bronze", next: "silver", remaining: TIER_MIN.silver - 1 });
    expect(tierProgress(3).ratio).toBeCloseTo(2 / (TIER_MIN.silver - TIER_MIN.bronze));
    expect(tierProgress(TIER_MIN.silver)).toMatchObject({ tier: "silver", next: "gold", ratio: 0 });
    expect(tierProgress(40)).toMatchObject({ tier: "gold", next: null, remaining: 0, ratio: 1 });
  });

  it("streak counts consecutive weeks, this week may still be empty", () => {
    expect(weekStreak([0, 1, 1, 0])).toBe(2);
    expect(weekStreak([1, 0, 1, 1])).toBe(2);
    expect(weekStreak([1, 1, 0, 0])).toBe(0);
    expect(weekStreak([])).toBe(0);
  });
});

describe("languages and matching", () => {
  it("reads labels first, else the repo suffix", () => {
    expect(canonicalLanguage("lang:TS")).toBe("TypeScript");
    expect(bountyLanguages(row({ labels: ["rust", "bounty"] }))).toEqual(["Rust"]);
    expect(bountyLanguages(row({ repoFullName: "teranga-labs/bitnob-js" }))).toEqual(["JavaScript"]);
    expect(bountyLanguages(row({ repoFullName: "teranga-labs/xof" }))).toEqual([]);
  });

  it("matches open bounties to the stack, TS and JS as one family, else shows all open", () => {
    const rows = [
      row({ id: "a", repoFullName: "o/kit-js", amountXof: 5000 }),
      row({ id: "b", repoFullName: "o/kit-js", amountXof: 9000 }),
      row({ id: "c", repoFullName: "o/core-py" }),
      row({ id: "d", repoFullName: "o/kit-js", status: "claimed" }),
    ];
    const m = forYou(rows, ["TypeScript"]);
    expect(m.matched).toBe(true);
    expect(m.rows.map((r) => r.id)).toEqual(["b", "a"]);
    const none = forYou(rows, ["Go"]);
    expect(none.matched).toBe(false);
    expect(none.rows.map((r) => r.id).sort()).toEqual(["a", "b", "c"]);
    expect(forYou([], ["Go"]).rows).toEqual([]);
  });

  it("prefers U1's saved stack, then GitHub languages, then the profile", () => {
    expect(pickStack(["Rust"], ["Go"], ["Python"])).toEqual(["Rust"]);
    expect(pickStack([], ["Go"], ["Python"])).toEqual(["Go"]);
    expect(pickStack(undefined, undefined, ["Python"])).toEqual(["Python"]);
  });
});

describe("claims and activity", () => {
  it("adds PR status, verdict and the claim window from the bounty detail", () => {
    const b104 = details.find((d) => d.id === "b-104")!;
    const c = claimCard({ bountyId: "b-104", issueTitle: b104.issueTitle, repoFullName: b104.repoFullName, expiresAt: "2026-10-20T00:00:00Z" }, b104, "moussa-diop");
    expect(c.pr).toMatchObject({ number: 31, ci: "success", merged: false });
    expect(c.verdict).toBe("fail");
    expect(c.createdAt).toBe("2026-10-17T15:50:00Z");
    expect(claimCard({ bountyId: "b-104", issueTitle: "", repoFullName: "", expiresAt: "2026-10-20T00:00:00Z" }, b104, "someone-else").pr).toBeNull();
    expect(claimCard({ bountyId: "zz", issueTitle: "t", repoFullName: "r", expiresAt: "2026-10-20T00:00:00Z" }, null, "x")).toMatchObject({ pr: null, verdict: null, createdAt: null });
  });

  it("formats the countdown and the elapsed window", () => {
    expect(formatCountdown((2 * 1440 + 3 * 60 + 12) * 60_000, "fr")).toBe("2 j 03 h 12 min");
    expect(formatCountdown((3 * 60 + 5) * 60_000, "en")).toBe("3 h 05 min");
    expect(formatCountdown(-5, "en")).toBe("0 min");
    expect(claimElapsed("2026-10-18T00:00:00Z", "2026-10-19T00:00:00Z", Date.parse("2026-10-18T06:00:00Z"))).toBeCloseTo(0.25);
    expect(claimElapsed(null, "2026-10-19T00:00:00Z", NOW)).toBeNull();
  });

  it("builds a newest-first feed of the user's events", () => {
    const feed = activityFeed(details.filter((d) => d.id === "b-107" || d.id === "b-103"), "awa-ndiaye");
    expect(feed.length).toBeGreaterThan(0);
    expect(feed.map((e) => e.occurredAt)).toEqual([...feed.map((e) => e.occurredAt)].sort().reverse());
    expect(feed.some((e) => e.type === "payout.succeeded" && e.bountyId === "b-107")).toBe(true);
    expect(feed.every((e) => e.type !== "claim.created" || details.find((d) => d.id === e.bountyId)!.timeline.some((t) => t.type === "claim.created" && t.actor === "awa-ndiaye"))).toBe(true);
  });
});

describe("explore filters", () => {
  it("filters by language, amount, repo and text", () => {
    const rows = [row({ id: "a", repoFullName: "o/kit-js", amountXof: 5000 }), row({ id: "b", repoFullName: "o/core-py", amountXof: 25000, issueTitle: "Speed up parser" })];
    expect(exploreOptions(rows)).toEqual({ languages: ["JavaScript", "Python"], repos: ["o/core-py", "o/kit-js"] });
    expect(applyExplore(rows, { ...NO_FILTER, language: "Python" }).map((r) => r.id)).toEqual(["b"]);
    expect(applyExplore(rows, { ...NO_FILTER, amount: "lt10" }).map((r) => r.id)).toEqual(["a"]);
    expect(applyExplore(rows, { ...NO_FILTER, repo: "o/kit-js" }).map((r) => r.id)).toEqual(["a"]);
    expect(applyExplore(rows, { ...NO_FILTER, q: "PARSER" }).map((r) => r.id)).toEqual(["b"]);
    expect(inBucket(10_000, "10to20")).toBe(true);
    expect(inBucket(20_000, "gte20")).toBe(true);
  });

  it("renders the grid in FR and EN with empty state", async () => {
    const board = await getBoard();
    const fr = renderToStaticMarkup(<ExploreGrid bounties={board.bounties.filter((b) => b.status === "funded")} lang="fr" now={NOW} />);
    expect(fr).toContain("Issues payées");
    expect(fr).toContain("Langage");
    const en = renderToStaticMarkup(<ExploreGrid bounties={[]} lang="en" now={NOW} />);
    expect(en).toContain("No funded issues right now");
    expect(timeAgo("2026-10-18T09:00:00Z", NOW, "fr")).toBe("il y a 3 h");
  });
});

describe("explore projects (mission select)", () => {
  it("groups open bounties by repo, most claimable money first", () => {
    const rows = [
      row({ id: "a", repoFullName: "o/kit-js", amountXof: 5000, status: "claimed" }),
      row({ id: "b", repoFullName: "o/core-py", amountXof: 8000, issueTitle: "Old", createdAt: "2026-10-10T00:00:00Z" }),
      row({ id: "c", repoFullName: "o/core-py", amountXof: 2000, issueTitle: "New", createdAt: "2026-10-17T00:00:00Z" }),
    ];
    const ps = projectSummaries(rows);
    expect(ps.map((p) => p.repoFullName)).toEqual(["o/core-py", "o/kit-js"]);
    expect(ps[0]).toMatchObject({ owner: "o", name: "core-py", openCount: 2, claimableCount: 2, totalXof: 10000, languages: ["Python"], latestTitle: "New" });
    expect(ps[1]).toMatchObject({ openCount: 1, claimableCount: 0 });
    expect(projectSummaries([])).toEqual([]);
  });

  it("renders project cards linking to their bounties, and the empty state", () => {
    const html = renderToStaticMarkup(<ProjectGrid projects={projectSummaries([row({ repoFullName: "o/kit-js" })])} lang="en" base="/app/explore" />);
    expect(html).toContain("/app/explore?repo=o%2Fkit-js");
    expect(html).toContain("https://github.com/o.png");
    expect(html).toContain("1 open bounty");
    expect(html).toContain("1 to claim");
    expect(renderToStaticMarkup(<ProjectGrid projects={[]} lang="fr" base="/explore" />)).toContain("Aucun projet");
  });

  it("reads q and repo from search params", () => {
    expect(exploreQuery({ q: [" x ", "y"], repo: "o/r" })).toEqual({ q: "x", repo: "o/r" });
    expect(exploreQuery({})).toEqual({ q: "", repo: "" });
  });
});

describe("/app/hunt", () => {
  it("loads the fixture hunter and renders every section", async () => {
    const data = await loadHunt(new Date(NOW));
    expect(data.me.user.login).toBe("awa-ndiaye");
    expect(data.progress.tier).toBe("bronze");
    expect(data.claims.ok && data.claims.value[0]?.bountyId).toBe("b-103");
    expect(data.forYou.ok && data.forYou.value.matched).toBe(true);
    const html = renderToStaticMarkup(<HuntView data={data} lang="fr" now={NOW} />);
    for (const s of ['id="claims"', 'id="earnings"', 'id="for-you"', "Mes claims", 'data-tour="claims"', 'data-tour="search"', "Rechercher une issue…", "Pour toi", "Activité", "pour passer Argent", 'data-tier="bronze"', "/extend"]) {
      expect(html).toContain(s);
    }
    const en = renderToStaticMarkup(<HuntView data={data} lang="en" now={NOW} />);
    expect(en).toContain("4 bounties to Silver");
    expect(en).toContain("Claude&#x27;s verdict");
  });

  it("shows section errors and empty states", async () => {
    const data = await loadHunt(new Date(NOW));
    const broken = { ...data, claims: { ok: false as const }, forYou: { ok: false as const }, feed: { ok: true as const, value: [] }, me: { ...data.me, payouts: [] } };
    const html = renderToStaticMarkup(<HuntView data={broken} lang="en" now={NOW} />);
    expect(html).toContain("This part couldn&#x27;t load.");
    expect(html).toContain("Nothing yet");
    expect(html).toContain("No earnings yet");
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import ProfilePage, { dynamic } from "../../app/u/[login]/page";
import { formatXof } from "../ui";
import { FIXTURE_LOGINS, formatDay, formatMinutes, heatmap, initialsOf, loadProfile } from "./data";
import { ProfileView } from "./profile-view";

const NOW = new Date("2026-10-17T20:00:00Z");

describe("profile data", () => {
  it("loads awa-ndiaye with her paid bounty and receipt details", () => {
    const p = loadProfile("awa-ndiaye", NOW)!;
    expect(p.initials).toBe("AN");
    expect(p.stats.totalXof).toBe(10000);
    expect(p.payoutVerified).toBe(true);
    expect(p.repos).toEqual([{ fullName: "teranga-labs/bitnob-js", url: "https://github.com/teranga-labs/bitnob-js", count: 1 }]);
    expect(p.work[0]).toMatchObject({ receiptHref: "/r/r-107", provider: "wave", bitnobReference: "PAYOUT_8C34EAC4BC", signed: true });
    expect(p.heat).toHaveLength(26);
    expect(p.heat[25]).toBe(1);
  });

  it("returns null for an unknown login", () => {
    expect(loadProfile("nobody-here")).toBeNull();
  });

  it("does not claim a verified account without paid work", () => {
    const p = loadProfile("moussa-diop", NOW)!;
    expect(p.work).toEqual([]);
    expect(p.payoutVerified).toBe(false);
    expect(p.heat.every((n) => n === 0)).toBe(true);
  });

  it("buckets payouts per week and ignores out-of-range dates", () => {
    const cells = heatmap(["2026-10-17T10:00:00Z", "2026-10-12T10:00:00Z", "2026-10-03T10:00:00Z", "2025-01-01T00:00:00Z", "2026-10-18T09:00:00Z"], NOW, 4);
    expect(cells).toEqual([0, 1, 0, 3]);
  });

  it("formats helpers", () => {
    expect(initialsOf("Seynabou Guèye", "seynabou-gueye")).toBe("SG");
    expect(initialsOf("", "zz-top")).toBe("ZZ");
    expect(formatDay("2026-10-17T18:26:00Z")).toBe("17 Oct 2026");
    expect(formatMinutes(5)).toBe("5 min");
    expect(formatMinutes(90)).toBe("1 h 30");
    expect(formatMinutes(0)).toBe("—");
  });

  it("is rendered per request (real data, I1) and the fixtures still cover the demo logins", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(FIXTURE_LOGINS).toEqual(expect.arrayContaining(["awa-ndiaye", "fatou-sall", "moussa-diop", "seynabou-gueye"]));
  });
});

describe("profile render", () => {
  it("renders header, totals, receipt + repo links and verified badge", () => {
    const html = renderToStaticMarkup(createElement(ProfileView, { data: loadProfile("fatou-sall", NOW)! }));
    expect(html).toContain("Fatou Sall");
    expect(html).toContain("@fatou-sall");
    expect(html).toContain("Payout account verified");
    expect(html).toContain('href="/r/r-113"');
    expect(html).toContain('href="https://github.com/naija-rails/ngn-kit"');
    expect(html).toContain(formatXof(10000));
    expect(html).toContain("Rust");
    expect(html).toContain("1 paid bounty in the last 26 weeks");
  });

  it("renders the empty state for a developer with no payouts", () => {
    const html = renderToStaticMarkup(createElement(ProfileView, { data: loadProfile("seynabou-gueye", NOW)! }));
    expect(html).toContain("No paid bounty yet");
    expect(html).not.toContain("Payout account verified");
    expect(html).toContain("Wolof");
  });

  it("page calls notFound() for unknown logins", async () => {
    await expect(ProfilePage({ params: Promise.resolve({ login: "ghost" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

import { describe, expect, it } from "vitest";
import { routeChecks } from "../src/api/index.js";
import { createReadSide, HAPPY_PATH_EVENTS, runHappyPath } from "../src/e2e/harness.js";

describe("I2: end-to-end happy path (offline fakes)", () => {
  it("fund → claim → PR → check → merge → paid, green 3 times in a row from an empty database", async () => {
    for (let i = 0; i < 3; i++) {
      const report = await runHappyPath();
      expect(report.events).toEqual([...HAPPY_PATH_EVENTS]);
      // After the merge the payout starts at once (objection window 0 in the demo): verified or already paying.
      expect(report.steps.map((s) => s.status)).toEqual([
        "unfunded",
        "funded",
        "claimed",
        "submitted",
        "submitted",
        expect.stringMatching(/^(verified|paying)$/),
        "paid",
      ]);
      expect(report.labels).toContain("bounty: paid");
      expect(report.statusComment).not.toBe("");
    }
  });

  it("the Lagos route (naira → bitcoin) funds the bounty too", async () => {
    const report = await runHappyPath({ fund: "ngn", amountXof: 300 });
    expect(report.events).toEqual([...HAPPY_PATH_EVENTS]);
    expect(report.steps[1]?.detail).toContain("₦");
  });

  it("I4: run twice on one served database, /live shows each naira bounty's route and the amounts add up", async () => {
    const readSide = createReadSide();
    const routes = [];
    for (let i = 0; i < 2; i++) {
      const report = await runHappyPath({ fund: "ngn", amountXof: 300, readSide });
      // Fake rates: ₦1 500/USDT, 600 FCFA/USDT, 100 000 USDT/BTC → 60 000 000 FCFA/BTC.
      // ₦810 = ceil(324 × 1500 / 600) for 300 + 15 + 9 FCFA; one ₦1 000 transfer sold for 667 sats, the bounty's share 540;
      // payout floor(300 × 1e8 / 60 000 000) = 500 sats; 40 sats (= 24 FCFA = fee + buffer) stay.
      expect(report.route).toEqual({ bountyId: report.bountyId, ngn: 810, satsBought: 540, xof: 300, feeXof: 15, bufferXof: 9, sats: 500, xofPerBtc: 60_000_000 });
      expect(routeChecks(report.route!).every((c) => c.ok)).toBe(true);
      routes.push(report.route);
    }
    expect(routes[0]!.bountyId).not.toBe(routes[1]!.bountyId);
    // Both bounties are on the served board; the newest naira one leads the route panel.
    const live = (await (await readSide.api.request("/api/live?format=json")).json()) as { cards: { bountyId: string; status: string }[]; route: { bountyId: string } };
    expect(live.cards.map((c) => [c.bountyId, c.status])).toEqual([[routes[1]!.bountyId, "paid"], [routes[0]!.bountyId, "paid"]]);
    expect(live.route.bountyId).toBe(routes[1]!.bountyId);
  });

  it("I4: a Lightning-funded run has no Lagos route", async () => {
    expect((await runHappyPath()).route).toBeNull();
  });

  it("every run uses its own repo, so runs never see each other's bounties", async () => {
    const [a, b] = await Promise.all([runHappyPath(), runHappyPath()]);
    expect(a.repo).not.toBe(b.repo);
    expect(a.bountyId).not.toBe(b.bountyId);
  });
});

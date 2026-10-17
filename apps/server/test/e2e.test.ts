import { describe, expect, it } from "vitest";
import { HAPPY_PATH_EVENTS, runHappyPath } from "../src/e2e/harness.js";

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

  it("every run uses its own repo, so runs never see each other's bounties", async () => {
    const [a, b] = await Promise.all([runHappyPath(), runHappyPath()]);
    expect(a.repo).not.toBe(b.repo);
    expect(a.bountyId).not.toBe(b.bountyId);
  });
});

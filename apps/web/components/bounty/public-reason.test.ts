import { describe, expect, it } from "vitest";
import { COPY } from "../../../server/src/github/status-comment/copy";
import { publicPayoutReason } from "../../../server/src/settlement/status-extras";
import { PAYOUT_REASONS, payoutReasonCode, publicPayoutText } from "./public-reason";

const SAMPLES = [
  "setup: payout cap exceeded",
  "user has no Lightning Address",
  "lnurl unreachable: mo***@walletofsatoshi.com: LNURL server timed out after 10000 ms",
  "lnurl refused: amount too large",
  "feature_not_enabled",
  "Bitnob reported the payment expired",
  "fetch failed ECONNREFUSED 10.0.0.3:443",
  "missing BITNOB_SECRET config",
  "POST /payouts failed: 422 invalid invoice",
  "something odd",
];

describe("public payout reasons (U5)", () => {
  it("maps raw errors exactly like the server", () => {
    for (const raw of SAMPLES) expect(payoutReasonCode(raw), raw).toBe(publicPayoutReason(raw));
  });

  it("uses the server's public copy", () => {
    expect(PAYOUT_REASONS).toEqual(COPY.en.payoutReasons);
  });

  it("keeps a reason the server already mapped, and never leaks the raw text", () => {
    expect(publicPayoutText("Bitnob didn't answer")).toBe("Bitnob didn't answer");
    const shown = publicPayoutText(SAMPLES[2]!);
    expect(shown).toBe("the developer's Lightning wallet didn't answer");
    expect(shown).not.toMatch(/lnurl|walletofsatoshi|10000/);
  });
});

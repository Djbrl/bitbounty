import { describe, expect, it } from "vitest";
import type { FundingRecord } from "../funding/store.js";
import { btcToSats, buildLiveRoute, routeChecks } from "./live-route.js";

const naira = (over: Partial<FundingRecord> = {}): FundingRecord => ({
  id: "f-ngn",
  bountyId: "b1",
  funderId: "lagos",
  rail: "ngn",
  sourceAmount: 81_000, // kobo: ₦810
  sourceCurrency: "NGN",
  bitnobRef: "va-1",
  paymentHash: null,
  paymentRequest: null,
  status: "paid",
  paidAt: "2026-10-18T10:00:00.000Z",
  amountXof: 300,
  feeXof: 15,
  bufferXof: 9,
  expiresAt: null,
  createdAt: "2026-10-18T09:59:00.000Z",
  ...over,
});
const bounty = { id: "b1", amountXof: 300 };
const payout = { status: "succeeded" as const, amountSats: 500, xofPerBtc: 60_000_000 };

describe("I4: Lagos route builder", () => {
  it("reads every leg from the records: ₦ from the funding, sats bought from the order, sats paid from the payout", () => {
    const route = buildLiveRoute(bounty, [naira()], payout, { btcReceived: "0.0000054", claimedKobo: 81_000 });
    expect(route).toEqual({ bountyId: "b1", ngn: 810, satsBought: 540, xof: 300, feeXof: 15, bufferXof: 9, sats: 500, xofPerBtc: 60_000_000 });
    expect(routeChecks(route!).every((c) => c.ok)).toBe(true);
    expect(routeChecks(route!).map((c) => c.text)).toEqual([
      "₦810 paid for 324 FCFA = 300 bounty + 15 fee (5%) + 9 buffer (3%)",
      "payout: floor(300 × 1e8 ÷ 60000000 FCFA/BTC) = 500 sats, paid 500 sats",
      "bought 540 sats with the naira ≥ 500 sats paid out (40 sats kept as fee + buffer)",
    ]);
  });

  it("counts only the bounty's share of the bitcoin when the funder sent more naira than asked", () => {
    // ₦1 000 arrived (one ₦1 000 sandbox transfer) for an ₦810 bounty: all of it is sold, ₦190 credited back.
    const route = buildLiveRoute(bounty, [naira()], payout, { btcReceived: "0.00000667", claimedKobo: 100_000 });
    expect(route?.ngn).toBe(810);
    expect(route?.satsBought).toBe(540); // floor(667 × 81 000 / 100 000)
  });

  it("is null unless the bounty has a paid naira funding", () => {
    expect(buildLiveRoute(bounty, [], payout)).toBeNull();
    expect(buildLiveRoute(bounty, [naira({ status: "pending" })], payout)).toBeNull();
    expect(buildLiveRoute(bounty, [naira({ rail: "lightning", sourceCurrency: "BTC" })], payout)).toBeNull();
    // A Lightning funding next to the paid naira one: the naira one is used.
    const both = [naira({ id: "f-ln", rail: "lightning", sourceCurrency: "BTC", sourceAmount: 2218 }), naira()];
    expect(buildLiveRoute(bounty, both, payout)?.ngn).toBe(810);
  });

  it("leaves unknown legs null instead of guessing", () => {
    // Funded, no payout yet, order amount unknown, and a Postgres row without the fee breakdown.
    const route = buildLiveRoute(bounty, [naira({ amountXof: 0, feeXof: 0, bufferXof: 0 })], undefined, null);
    expect(route).toEqual({ bountyId: "b1", ngn: 810, satsBought: null, xof: 300, feeXof: null, bufferXof: null, sats: null, xofPerBtc: null });
    expect(routeChecks(route!)).toEqual([]);
    // A failed payout attempt isn't shown as the payout.
    expect(buildLiveRoute(bounty, [naira()], { ...payout, status: "failed" })?.sats).toBeNull();
    // Less sold than the bounty's naira (shouldn't happen): no share computed.
    expect(buildLiveRoute(bounty, [naira()], payout, { btcReceived: "0.0000054", claimedKobo: 50_000 })?.satsBought).toBeNull();
  });

  it("flags sums that don't add up", () => {
    const route = { bountyId: "b1", ngn: 810, satsBought: 400, xof: 300, feeXof: 10, bufferXof: 9, sats: 499, xofPerBtc: 60_000_000 };
    expect(routeChecks(route).map((c) => c.ok)).toEqual([false, false, false]);
  });

  it("converts the order's BTC amount to sats", () => {
    expect([btcToSats("0.0000054"), btcToSats("0.0002"), btcToSats("1"), btcToSats(null), btcToSats("abc"), btcToSats("-1"), btcToSats("0")]).toEqual([
      540, 20_000, 100_000_000, null, null, null, null,
    ]);
  });
});

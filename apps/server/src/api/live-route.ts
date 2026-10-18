import type { Bounty, Payout } from "@bitbounty/core";
import type { NgnAccount } from "../funding/ngn.js";
import { BUFFER_PERCENT, FEE_PERCENT, priceBounty } from "../funding/pricing.js";
import type { FundingRecord } from "../funding/store.js";

/**
 * I4: the Lagos route of a naira-funded bounty, for the /live screen:
 *   ₦ paid by bank transfer (Lagos) → bitcoin bought with it → FCFA bounty, paid in sats (Dakar).
 *
 * Every number is read from a stored record, never recomputed with today's rates:
 * - `ngn`        = funding.sourceAmount / 100 (kobo → ₦). B4 asks for
 *                  max(₦500, ceil((bounty + fee + buffer) × NGN/USDT ÷ XOF/USDT)) at funding time.
 * - `feeXof`, `bufferXof` = the funding row's 5% fee and 3% buffer (null when the row has no breakdown,
 *                  e.g. Postgres rows read by DrizzleFundingReader), so `ngn` pays for xof + fee + buffer.
 * - `satsBought` = the NGN→BTC order's receive quantity × 1e8 (NgnAccount.btcReceived), when known,
 *                  for the bounty's share of what was sold: B4 sells everything received (`claimedKobo`)
 *                  and credits the over-deposit back to the funder, so
 *                  satsBought = floor(orderSats × funding.sourceAmount ÷ claimedKobo).
 * - `xof`        = the bounty amount (what the developer receives).
 * - `sats`, `xofPerBtc` = the Lightning payout row (B6): sats = floor(xof × 1e8 ÷ xofPerBtc).
 */
export interface LiveRoute {
  bountyId: string;
  ngn: number;
  satsBought: number | null;
  xof: number;
  feeXof: number | null;
  bufferXof: number | null;
  sats: number | null;
  xofPerBtc: number | null;
}

/** The paid naira funding of a bounty, if it was funded from Lagos. */
export function paidNairaFunding(fundings: FundingRecord[]): FundingRecord | undefined {
  return fundings.find((f) => f.rail === "ngn" && f.sourceCurrency === "NGN" && f.status === "paid");
}

/** null unless the bounty has a paid naira funding. Missing legs (no order amount, no payout yet) are null. */
export function buildLiveRoute(
  bounty: Pick<Bounty, "id" | "amountXof">,
  fundings: FundingRecord[],
  payout?: Pick<Payout, "amountSats" | "xofPerBtc" | "status"> | null,
  account?: Pick<NgnAccount, "btcReceived" | "claimedKobo"> | null,
): LiveRoute | null {
  const f = paidNairaFunding(fundings);
  if (!f) return null;
  const orderSats = btcToSats(account?.btcReceived ?? null);
  const sold = account?.claimedKobo ?? f.sourceAmount;
  const satsBought = orderSats !== null && sold >= f.sourceAmount && sold > 0 ? Math.floor((orderSats * f.sourceAmount) / sold) : null;
  // Only a row that stored what the bounty needed (amountXof) has a real fee/buffer; 0 there means "not stored".
  const breakdown = f.amountXof > 0;
  const paid = payout && payout.status !== "failed" ? payout : null;
  return {
    bountyId: bounty.id,
    ngn: Math.floor(f.sourceAmount / 100),
    satsBought,
    xof: bounty.amountXof,
    feeXof: breakdown ? f.feeXof : null,
    bufferXof: breakdown ? f.bufferXof : null,
    sats: paid?.amountSats ?? null,
    xofPerBtc: paid?.xofPerBtc ?? null,
  };
}

/**
 * The sums a reviewer can redo by hand on a route (only for the legs it has):
 * fee and buffer are B4's 5% / 3% of the bounty, the payout is floor(xof × 1e8 ÷ xofPerBtc), and the
 * bitcoin the naira bought covers the sats paid out (the rest is the fee + buffer).
 */
export function routeChecks(r: LiveRoute): { ok: boolean; text: string }[] {
  const out: { ok: boolean; text: string }[] = [];
  if (r.feeXof !== null && r.bufferXof !== null) {
    const p = priceBounty(r.xof);
    out.push({
      ok: p.feeXof === r.feeXof && p.bufferXof === r.bufferXof,
      text: `₦${r.ngn} paid for ${p.totalXof} FCFA = ${r.xof} bounty + ${r.feeXof} fee (${FEE_PERCENT}%) + ${r.bufferXof} buffer (${BUFFER_PERCENT}%)`,
    });
  }
  if (r.sats !== null && r.xofPerBtc !== null) {
    const want = Math.floor((r.xof * 1e8) / r.xofPerBtc);
    out.push({ ok: want === r.sats, text: `payout: floor(${r.xof} × 1e8 ÷ ${r.xofPerBtc} FCFA/BTC) = ${want} sats, paid ${r.sats} sats` });
  }
  if (r.satsBought !== null && r.sats !== null) {
    out.push({ ok: r.satsBought >= r.sats, text: `bought ${r.satsBought} sats with the naira ≥ ${r.sats} sats paid out (${r.satsBought - r.sats} sats kept as fee + buffer)` });
  }
  return out;
}

/** "0.0000054" BTC → 540 sats. Anything unreadable → null. */
export function btcToSats(btc: string | null): number | null {
  if (!btc || !/^\d+(\.\d+)?$/.test(btc.trim())) return null;
  const sats = Math.round(Number(btc) * 1e8);
  return Number.isSafeInteger(sats) && sats > 0 ? sats : null;
}

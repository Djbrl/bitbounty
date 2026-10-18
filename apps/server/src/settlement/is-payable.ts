import type { Payout } from "@bitbounty/core";
import type { BountyRepo } from "../bounties/repo.js";

/**
 * M1: a row is resumed after a restart only if settlement already started it (bounty past the
 * objection window, `paying` / `payout_failed`) and it still pays the claimant or @user the bounty's amount.
 * CR15: when `/pay @user` stored the recipient on the bounty, resume pays @user instead of the claimant.
 */
export function buildIsPayable(bountyRepo: BountyRepo): (row: Payout) => Promise<true | string> {
  return async (row: Payout) => {
    const bounty = await bountyRepo.findById(row.bountyId);
    if (!bounty) return "bounty not found";
    if (bounty.status !== "paying" && bounty.status !== "payout_failed") {
      return `bounty is ${bounty.status}, waiting for settlement`;
    }
    if (bounty.amountXof !== row.amountXof) {
      return `bounty is ${bounty.amountXof} FCFA, the payout ${row.amountXof} FCFA`;
    }
    if (bounty.payeeLogin) {
      const same = row.userId.toLowerCase() === `github:${bounty.payeeLogin}`.toLowerCase();
      return same ? true : `the payout's recipient is no longer @${bounty.payeeLogin}`;
    }
    const c = await bountyRepo.activeClaimant(row.bountyId);
    const same = c && (c.userId === row.userId || row.userId.toLowerCase() === `github:${c.login}`.toLowerCase());
    return same ? true : "the payout's developer is no longer the bounty's claimant";
  };
}

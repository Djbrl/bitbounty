import { createHash, timingSafeEqual } from "node:crypto";
import { maskLightningAddress, type Bounty, type BountyStatus, type Payout } from "@bitbounty/core";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { BountyRepo } from "../bounties/repo.js";
import { FundingError, type FundingTarget } from "../funding/lightning.js";
import type { FundingRecord, FundingStore } from "../funding/store.js";
import type { PayoutStore } from "../payouts/store.js";
import type { ActivityEntry, ActivityLog } from "./activity.js";
import { groupThousands } from "./format.js";
import {
  bountySummary,
  bountyView,
  claimView,
  fundingView,
  loginOf,
  median,
  payoutView,
  submissionView,
  timelineOf,
  type BountyDetail,
  type BountySummary,
} from "./views.js";

export interface ReadApiDeps {
  repo: BountyRepo;
  activity: ActivityLog;
  fundings?: Pick<FundingStore, "listByBounty">;
  payouts?: Pick<PayoutStore, "get" | "getByBounty" | "listByStatus">;
  /** B1 Lightning funding (null when Bitnob keys aren't set). */
  lightning?: { invoice(target: FundingTarget): Promise<FundingRecord>; watch(fundingId: string): void } | null;
  /**
   * Shared secret with the web app. The web proxy sends `Authorization: Bearer <token>` and
   * `X-BitBounty-User: <github login>` from the Auth.js session; without it /api/me is 401.
   */
  internalToken?: string;
  /** U1: the Lightning Address saved at onboarding (full; /api/me masks it). */
  lightningAddressOf?: (login: string) => Promise<string | null>;
  /** SSE keep-alive comment interval (ms). */
  keepAliveMs?: number;
}

/** Columns of the /live projector screen (apps/web/components/live/live-data.ts). */
export const LIVE_COLUMNS: BountyStatus[] = ["funded", "claimed", "submitted", "verified", "paying", "paid"];
const PUBLIC_HIDDEN: readonly BountyStatus[] = ["unfunded", "cancelled", "refunded"];
const HELD: readonly BountyStatus[] = ["funded", "claimed", "submitted", "verified", "paying", "on_hold", "payout_failed"];
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const PAYOUT_STATUSES: Payout["status"][] = ["pending", "processing", "succeeded", "failed"];

/**
 * I1: the read side of the HTTP API (docs/plan.md §3), in the shapes of fixtures/types.ts so
 * the web pages built on fixtures run unchanged on real data:
 * GET /api/board · /api/bounties[?status=] · /api/bounties/:id · /api/dashboard · /api/users/:login
 * · /api/receipts/:id · /api/me · /api/live (SSE) · POST|GET /api/bounties/:id/funding.
 */
export function readApiRoutes(deps: ReadApiDeps) {
  const { repo, activity } = deps;
  const api = new Hono();

  const summary = async (b: Bounty): Promise<BountySummary> => {
    const [claimant, sub] = await Promise.all([repo.activeClaimant(b.id), repo.currentSubmission(b.id)]);
    return bountySummary(b, { claimedBy: claimant?.login ?? null, prNumber: sub?.prNumber ?? null, updatedAt: activity.lastAt(b.id) });
  };
  const summaries = (list: Bounty[]) => Promise.all(list.map(summary));

  /** merge → paid minutes, for paid bounties with both dates. */
  const mergeToPay = async (paid: Bounty[]) => {
    const out: number[] = [];
    for (const b of paid) {
      const [sub, payout] = await Promise.all([repo.currentSubmission(b.id), deps.payouts?.getByBounty(b.id)]);
      if (sub?.mergedAt && payout?.paidAt) out.push(Math.max(0, Math.round((Date.parse(payout.paidAt) - Date.parse(sub.mergedAt)) / 60_000)));
    }
    return out;
  };

  const payoutsOf = async (login: string): Promise<Payout[]> => {
    if (!deps.payouts) return [];
    const all = (await Promise.all(PAYOUT_STATUSES.map((s) => deps.payouts!.listByStatus(s)))).flat();
    return all.filter((p) => loginOf(p.userId)?.toLowerCase() === login.toLowerCase());
  };

  api.get("/api/bounties", async (c) => {
    const status = c.req.query("status");
    const list = await repo.list(500);
    return c.json(await summaries(status ? list.filter((b) => b.status === status) : list));
  });

  api.get("/api/bounties/:id", async (c) => {
    const detail = await bountyDetail(c.req.param("id"));
    return detail ? c.json(detail) : c.json({ error: "bounty_not_found", id: c.req.param("id") }, 404);
  });

  async function bountyDetail(id: string): Promise<BountyDetail | null> {
    const b = await repo.findById(id);
    if (!b) return null;
    const [claim, sub, fundings, payout] = await Promise.all([
      repo.activeClaim(b.id),
      repo.currentSubmission(b.id),
      deps.fundings?.listByBounty(b.id) ?? Promise.resolve([]),
      deps.payouts?.getByBounty(b.id) ?? Promise.resolve(undefined),
    ]);
    const entries = activity.timeline(b.id);
    const at = (type: ActivityEntry["type"]) => entries.find((e) => e.type === type)?.occurredAt ?? b.createdAt;
    return {
      ...bountyView(b, activity.lastAt(b.id)),
      fundings: fundings.map(fundingView),
      claims: claim ? [claimView(claim, at("claim.created"), b.status)] : [],
      submission: sub ? submissionView(sub, b, at("pr.linked")) : null,
      payout: payout ? payoutView(payout, at("payout.started")) : null,
      timeline: timelineOf(b, entries),
    };
  }

  api.get("/api/board", async (c) => {
    const list = await repo.list(500);
    const paid = list.filter((b) => b.status === "paid");
    const paidPayouts = deps.payouts ? await deps.payouts.listByStatus("succeeded") : [];
    return c.json({
      stats: {
        paidCount: paid.length,
        paidTotalXof: paid.reduce((s, b) => s + b.amountXof, 0),
        medianMinutesMergeToPay: median(await mergeToPay(paid.slice(0, 100))),
        developersPaid: new Set(paidPayouts.map((p) => p.userId.toLowerCase())).size,
      },
      bounties: await summaries(list.filter((b) => !PUBLIC_HIDDEN.includes(b.status)).slice(0, 50)),
      external: [],
    });
  });

  api.get("/api/dashboard", async (c) => {
    const login = userFrom(c);
    // With a token configured, the dashboard is per maintainer: no valid session, no data.
    if (deps.internalToken && !login) return c.json({ error: "unauthorized" }, 401);
    const all = await repo.list(500);
    // Signed in: the maintainer's own bounties. Auth off (local demo): everything.
    const mine = login ? all.filter((b) => loginOf(b.funderId)?.toLowerCase() === login.toLowerCase()) : all;
    const byRepo = new Map<string, Bounty[]>();
    for (const b of mine) byRepo.set(b.repoFullName, [...(byRepo.get(b.repoFullName) ?? []), b]);
    const paid = mine.filter((b) => b.status === "paid");
    const heldXof = mine.filter((b) => HELD.includes(b.status)).reduce((s, b) => s + b.amountXof, 0);
    const spentXof = paid.reduce((s, b) => s + b.amountXof, 0);
    type Action = { bountyId: string; action: "fund" | "pay_or_reject" | "update_account" | "confirm_criteria"; text: string };
    const needsAction = mine.flatMap((b): Action[] => {
      const ref = `#${b.issueNumber}`;
      if (b.status === "unfunded") return [{ bountyId: b.id, action: "fund" as const, text: `${ref} is waiting for funding (${groupThousands(b.amountXof)} FCFA)` }];
      if (b.status === "on_hold") return [{ bountyId: b.id, action: "pay_or_reject" as const, text: `${ref} is on hold: /pay or /reject` }];
      if (b.status === "payout_failed") return [{ bountyId: b.id, action: "update_account" as const, text: `${ref}: the payout failed, the developer must update their account` }];
      if (b.criteria.length === 0 && b.status !== "cancelled" && b.status !== "refunded") {
        return [{ bountyId: b.id, action: "confirm_criteria" as const, text: `${ref} has no acceptance criteria yet` }];
      }
      return [];
    });
    return c.json({
      maintainer: login ?? "maintainer",
      repos: [...byRepo].map(([fullName, bs]) => {
        const done = bs.filter((b) => b.status === "paid" || b.status === "refunded" || b.status === "cancelled");
        return {
          fullName,
          openIssues: bs.filter((b) => !done.includes(b)).length,
          activeBounties: bs.filter((b) => HELD.includes(b.status)).length,
          paidPct: done.length ? Math.round((bs.filter((b) => b.status === "paid").length / done.length) * 100) : 0,
        };
      }),
      stats: {
        // No budget setting yet: the budget shown is what has been committed so far.
        budgetXof: heldXof + spentXof,
        heldXof,
        spentXof,
        activeCount: mine.filter((b) => HELD.includes(b.status)).length,
        paidCount: paid.length,
        medianMinutesMergeToPay: median(await mergeToPay(paid.slice(0, 100))),
      },
      bountyIds: mine.map((b) => b.id),
      needsAction,
      // "Price my backlog" (A3) fills this once wired; empty hides the funding bar.
      backlog: [],
      bounties: await summaries(mine),
    });
  });

  api.get("/api/users/:login", async (c) => {
    const login = c.req.param("login");
    if (!LOGIN_RE.test(login)) return c.json({ error: "user_not_found", login }, 404);
    const paidPayouts = (await payoutsOf(login)).filter((p) => p.status === "succeeded" && p.paidAt);
    const claims = (await repo.listActiveClaims()).filter((cl) => cl.login.toLowerCase() === login.toLowerCase());
    if (!paidPayouts.length && !claims.length) return c.json({ error: "user_not_found", login }, 404);
    const work = [];
    const minutes: number[] = [];
    for (const p of paidPayouts) {
      const b = await repo.findById(p.bountyId);
      if (!b) continue;
      const sub = await repo.currentSubmission(b.id);
      if (sub?.mergedAt) minutes.push(Math.max(0, Math.round((Date.parse(p.paidAt!) - Date.parse(sub.mergedAt)) / 60_000)));
      work.push({ bountyId: b.id, repoFullName: b.repoFullName, issueTitle: b.issueTitle, prNumber: sub?.prNumber ?? 0, amountXof: p.amountXof, paidAt: p.paidAt!, receiptId: p.id });
    }
    work.sort((a, b) => b.paidAt.localeCompare(a.paidAt));
    return c.json({
      user: userView(login, work.at(-1)?.paidAt),
      stats: {
        paidCount: work.length,
        totalXof: work.reduce((s, w) => s + w.amountXof, 0),
        repos: new Set(work.map((w) => w.repoFullName.toLowerCase())).size,
        // Only paid work is tracked per developer for now, so everything listed was accepted.
        acceptedPct: work.length ? 100 : 0,
        medianMinutesMergeToPay: median(minutes),
      },
      languages: [],
      work,
    });
  });

  api.get("/api/receipts/:id", async (c) => {
    const id = c.req.param("id");
    const p = deps.payouts ? await deps.payouts.get(id) : undefined;
    const b = p ? await repo.findById(p.bountyId) : undefined;
    const sub = b ? await repo.currentSubmission(b.id) : undefined;
    if (!p || p.status !== "succeeded" || !p.paidAt || !b || !sub?.mergedAt) return c.json({ error: "receipt_not_found", id }, 404);
    const funding = (await deps.fundings?.listByBounty(b.id))?.find((f) => f.status === "paid");
    const receipt = {
      id: p.id,
      bountyId: b.id,
      repoFullName: b.repoFullName,
      issueNumber: b.issueNumber,
      issueTitle: b.issueTitle,
      prNumber: sub.prNumber,
      prUrl: `https://github.com/${b.repoFullName}/pull/${sub.prNumber}`,
      recipientLogin: loginOf(p.userId) ?? p.userId,
      amountXof: p.amountXof,
      // B6: the developer's Lightning Address, masked. Null on legacy (mobile money) rows.
      lightningAddress: p.lightningAddress ? maskLightningAddress(p.lightningAddress) : null,
      fundedWith: {
        rail: funding?.rail ?? "lightning",
        sourceAmount: funding?.sourceAmount ?? 0,
        sourceCurrency: funding?.sourceCurrency ?? "BTC",
        funderLogin: loginOf(b.funderId) ?? b.funderId,
      },
      mergedAt: sub.mergedAt,
      paidAt: p.paidAt,
      minutesMergeToPay: Math.max(0, Math.round((Date.parse(p.paidAt) - Date.parse(sub.mergedAt)) / 60_000)),
      bitnobReference: p.bitnobPayoutId ?? p.reference,
      // B6: paid in sats over Lightning, at the rate stored on the payout row.
      ...(p.rail === "lightning"
        ? { paidWith: { rail: "lightning" as const, amountSats: p.amountSats ?? null, xofPerBtc: p.xofPerBtc ?? null, paymentHash: p.paymentHash ?? null } }
        : {}),
    };
    // Anyone can recompute it from the fields: same receipt → same digest.
    const signature = `sha256:${createHash("sha256").update(JSON.stringify(receipt)).digest("hex")}`;
    return c.json({ ...receipt, signature });
  });

  api.get("/api/me", async (c) => {
    const login = userFrom(c);
    if (!login) return c.json({ error: "unauthorized" }, 401);
    const payouts = await payoutsOf(login);
    const claims = (await repo.listActiveClaims()).filter((cl) => cl.login.toLowerCase() === login.toLowerCase());
    const activeClaims = [];
    for (const cl of claims) {
      const b = await repo.findById(cl.bountyId);
      if (b) activeClaims.push({ bountyId: b.id, issueTitle: b.issueTitle, repoFullName: b.repoFullName, expiresAt: cl.expiresAt });
    }
    const paid = payouts.filter((p) => p.status === "succeeded");
    // U1: the payout account is the Lightning Address saved at onboarding (checked to resolve when saved).
    const address = (await deps.lightningAddressOf?.(login)) ?? null;
    return c.json({
      user: userView(login),
      payoutAccount: address
        ? { userId: `github:${login}`, country: "SN", status: "verified", lightningAddress: maskLightningAddress(address), verifiedAt: null, lockedUntil: null }
        : null,
      earnings: { totalXof: paid.reduce((s, p) => s + p.amountXof, 0), paidCount: paid.length },
      activeClaims,
      payouts: payouts.map((p) => ({
        bountyId: p.bountyId,
        amountXof: p.amountXof,
        status: p.status,
        paidAt: p.paidAt,
        receiptId: p.status === "succeeded" ? p.id : null,
      })),
    });
  });

  api.post("/api/bounties/:id/funding", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const rail = body && typeof body === "object" ? (body as { rail?: unknown }).rail : undefined;
    if (rail !== "lightning" && rail !== "usdt" && rail !== "ngn") return c.json({ error: "invalid_rail", rail }, 400);
    const b = await repo.findById(c.req.param("id"));
    if (!b) return c.json({ error: "bounty_not_found", id: c.req.param("id") }, 404);
    if (b.status !== "unfunded") return c.json({ error: "already_funded", status: b.status }, 409);
    if (rail !== "lightning") return c.json({ error: "rail_unavailable", rail, hint: "only Lightning is wired on this server" }, 501);
    if (!deps.lightning) return c.json({ error: "funding_not_configured", hint: "set BITNOB_CLIENT_ID and BITNOB_CLIENT_SECRET" }, 503);
    try {
      const f = await deps.lightning.invoice({ bountyId: b.id, funderId: b.funderId });
      deps.lightning.watch(f.id);
      return c.json({
        rail: "lightning",
        amountXof: f.amountXof,
        feeXof: f.feeXof,
        bufferXof: f.bufferXof,
        totalXof: f.amountXof + f.feeXof + f.bufferXof,
        invoice: f.paymentRequest ?? "",
        paymentHash: f.paymentHash ?? "",
        amountSats: f.sourceAmount,
        expiresAt: f.expiresAt ?? new Date(Date.now() + 15 * 60_000).toISOString(),
      });
    } catch (err) {
      if (err instanceof FundingError) {
        const status = err.code === "BOUNTY_NOT_FOUND" ? 404 : 409;
        return c.json({ error: err.code === "ALREADY_FUNDED" ? "already_funded" : err.code.toLowerCase(), message: err.message }, status);
      }
      console.error("[api] funding", err);
      return c.json({ error: "funding_failed" }, 502);
    }
  });

  api.get("/api/bounties/:id/funding", async (c) => {
    const b = await repo.findById(c.req.param("id"));
    if (!b) return c.json({ error: "bounty_not_found", id: c.req.param("id") }, 404);
    return c.json({ status: b.status === "unfunded" ? "pending" : "paid", bountyStatus: b.status });
  });

  api.get("/api/live", async (c) => {
    const snapshot = async () => {
      const list = (await repo.list(200)).filter((b) => LIVE_COLUMNS.includes(b.status)).slice(0, 40);
      const cards = await Promise.all(
        list.map(async (b) => ({
          bountyId: b.id,
          status: b.status,
          repoFullName: b.repoFullName,
          issueTitle: b.issueTitle,
          amountXof: b.amountXof,
          who: (await repo.activeClaimant(b.id))?.login ?? null,
          city: null,
        })),
      );
      return { columns: LIVE_COLUMNS, cards };
    };
    return streamSSE(c, async (stream) => {
      const queue: ActivityEntry[] = [];
      let wake: (() => void) | undefined;
      const unsubscribe = activity.subscribe((e) => {
        queue.push(e);
        wake?.();
      });
      stream.onAbort(() => {
        unsubscribe();
        wake?.();
      });
      try {
        await stream.writeSSE({ event: "snapshot", data: JSON.stringify(await snapshot()) });
        while (!stream.aborted) {
          const e = queue.shift();
          if (e) {
            await stream.writeSSE({
              event: "transition",
              data: JSON.stringify({ delayMs: 0, bountyId: e.bountyId, event: e.type, from: e.from ?? "unfunded", to: e.to, text: e.text }),
            });
            continue;
          }
          let timer: NodeJS.Timeout | undefined;
          await new Promise<void>((resolve) => {
            wake = resolve;
            timer = setTimeout(resolve, deps.keepAliveMs ?? 20_000);
          });
          clearTimeout(timer);
          wake = undefined;
          if (!queue.length && !stream.aborted) await stream.write(": keep-alive\n\n");
        }
      } finally {
        unsubscribe();
      }
    });
  });

  // Not on this server yet: say so clearly instead of a bare 404 (the pages show the message).
  api.post("/api/backlog/fund", (c) =>
    c.json({ error: "not_available", hint: "funding a backlog batch isn't wired yet; fund bounties one by one from /pay/:id" }, 501),
  );
  api.post("/api/me/payout-account", (c) =>
    c.json({ error: "onboarding_not_configured", hint: "the payout-account onboarding (B3) isn't wired into this server yet" }, 501),
  );

  function userFrom(c: Context): string | null {
    return requestUser(c, deps.internalToken);
  }

  return api;
}

/**
 * The GitHub login the web proxy vouches for: `Authorization: Bearer <INTERNAL_API_TOKEN>` +
 * `X-BitBounty-User: <login>`. Null without a configured token, a wrong token or a bad login.
 */
export function requestUser(c: Context, token: string | undefined): string | null {
  if (!token) return null;
  const auth = c.req.header("authorization") ?? "";
  const given = Buffer.from(auth.replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(token);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  const login = c.req.header("x-bitbounty-user")?.trim() ?? "";
  return LOGIN_RE.test(login) ? login : null;
}

function userView(login: string, since?: string) {
  return {
    id: `github:${login}`,
    githubId: 0,
    login,
    avatarUrl: `https://github.com/${login}.png`,
    createdAt: since ?? new Date().toISOString(),
    name: login,
    city: "",
  };
}

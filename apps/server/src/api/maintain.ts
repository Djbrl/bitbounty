// U4: the maintainer home (/app/maintain) and its Pay / Hold buttons.
// GET  /api/maintain                        → summary, review queue, repos, payouts, agents
// POST /api/maintain/bounties/:id/pay       → same path as `/pay` on the issue
// POST /api/maintain/bounties/:id/hold {note?} → same path as `/hold`
// Identity as /api/me: `Authorization: Bearer <INTERNAL_API_TOKEN>` + `X-BitBounty-User: <login>`.
import { timingSafeEqual } from "node:crypto";
import { canTransition, type Bounty, type BountyStatus } from "@bitbounty/core";
import { Hono, type Context } from "hono";
import type { Agent, BudgetView } from "../agents/index.js";
import type { BountyRepo } from "../bounties/repo.js";
import type { FundingStore } from "../funding/store.js";
import type { PayoutStore } from "../payouts/store.js";
import type { PayoutFailureReason } from "../github/status-comment/index.js";
import { runMaintainerDecision, type GithubWriter, type MaintainerDecision, type WiringDeps } from "../github/wiring/index.js";
import { publicPayoutReason } from "../settlement/status-extras.js";
import { loginOf, median } from "./views.js";

export interface MaintainDeps {
  repo: BountyRepo;
  fundings?: Pick<FundingStore, "listByBounty">;
  payouts?: Pick<PayoutStore, "getByBounty">;
  /** Repos where the GitHub App is installed on the user's account (U2's mode store). */
  installedRepos?: (login: string) => Promise<string[]>;
  /** A4: agent keys (never their hash) and budgets, read-only. */
  agents?: { list(): Agent[]; budget(agent: Agent): Promise<BudgetView> };
  /**
   * The GitHub App's comment wiring and a writer for a repo. Pay / Hold need both: they run
   * `runMaintainerDecision`, the `/pay` / `/hold` path. Absent → 503.
   */
  decide?: { wiring: WiringDeps; writerForRepo: (repoFullName: string) => Promise<GithubWriter> };
  internalToken?: string;
  now?: () => Date;
}

export type CiState = "success" | "failure" | "pending" | "unknown";

export interface ReviewItem {
  bountyId: string;
  repoFullName: string;
  issueNumber: number;
  issueTitle: string;
  amountXof: number;
  status: BountyStatus;
  prNumber: number | null;
  prUrl: string | null;
  developer: string | null;
  verdict: Bounty["verdict"];
  summary: string | null;
  /** Claude's check per criterion; `met: null` when no report yet. */
  criteria: { text: string; met: boolean | null; evidence: string | null }[];
  ci: CiState;
  merged: boolean;
  canPay: boolean;
  canHold: boolean;
}

export interface MaintainPayout {
  bountyId: string;
  repoFullName: string;
  issueNumber: number;
  issueTitle: string;
  developer: string | null;
  amountXof: number;
  amountSats: number | null;
  status: "paying" | "paid" | "failed";
  /** I3's short public reason, never the raw error. */
  reason: PayoutFailureReason | null;
  receiptId: string | null;
  at: string | null;
}

export interface MaintainHome {
  maintainer: string;
  summary: {
    fundedXof: number;
    fundedSats: number | null;
    atStakeXof: number;
    paidThisMonthXof: number;
    paidThisMonthCount: number;
    medianMinutesMergeToPay: number | null;
  };
  queue: ReviewItem[];
  repos: { fullName: string; openBounties: number; paidCount: number }[];
  payouts: MaintainPayout[];
  agents: { name: string; monthlyBudgetXof: number; committedThisMonthXof: number; remainingXof: number; perTaskMaxXof: number; allowedRepos: string[] }[];
}

const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const FUNDED: readonly BountyStatus[] = ["funded", "claimed", "submitted", "verified", "paying", "on_hold", "payout_failed", "paid"];
const AT_STAKE: readonly BountyStatus[] = ["funded", "claimed", "submitted", "verified", "paying", "on_hold", "payout_failed"];
const OPEN: readonly BountyStatus[] = ["unfunded", ...AT_STAKE];
/** What waits for the maintainer: a PR in, verified inside the objection window, or on hold. */
const REVIEW: readonly BountyStatus[] = ["submitted", "verified", "on_hold"];
const PAYOUT_STATUS: Partial<Record<BountyStatus, MaintainPayout["status"]>> = { paying: "paying", paid: "paid", payout_failed: "failed" };

/**
 * CI is not stored on the bounty; what the status tells for sure: `verified` after a merge needs
 * green CI (or a manual /pay), `on_hold` after a merge with a passing verdict means CI was red.
 */
function ciOf(b: Bounty, merged: boolean): CiState {
  if (!merged) return "pending";
  if (b.status === "verified") return "success";
  if (b.status === "on_hold" && b.verdict === "pass") return "failure";
  return "unknown";
}

export function maintainRoutes(deps: MaintainDeps) {
  const { repo } = deps;
  const api = new Hono();

  const userFrom = (c: Context): string | null => {
    const token = deps.internalToken;
    if (!token) return null;
    const given = Buffer.from((c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, ""));
    const want = Buffer.from(token);
    if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
    const login = c.req.header("x-bitbounty-user")?.trim() ?? "";
    return LOGIN_RE.test(login) ? login : null;
  };

  api.get("/api/maintain", async (c) => {
    const login = userFrom(c);
    if (deps.internalToken && !login) return c.json({ error: "unauthorized" }, 401);
    return c.json(await home(login));
  });

  async function home(login: string | null): Promise<MaintainHome> {
    const lower = login?.toLowerCase();
    const installed = login && deps.installedRepos ? await deps.installedRepos(login).catch(() => []) : [];
    const installedSet = new Set(installed.map((r) => r.toLowerCase()));
    const myAgents = (deps.agents?.list() ?? []).filter((a) => !a.revoked && (!lower || a.ownerLogin.toLowerCase() === lower));
    const agentIds = new Set(myAgents.map((a) => a.id));
    const all = await repo.list(500);
    // Signed in: bounties they funded, on their installed repos, or posted by their agents. Auth off (local demo): everything.
    const mine = lower
      ? all.filter((b) => loginOf(b.funderId)?.toLowerCase() === lower || installedSet.has(b.repoFullName.toLowerCase()) || agentIds.has(b.funderId))
      : all;

    const now = deps.now?.() ?? new Date();
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    let fundedSats = 0;
    let satsKnown = false;
    let paidThisMonthXof = 0;
    let paidThisMonthCount = 0;
    const minutes: number[] = [];
    const queue: ReviewItem[] = [];
    const payouts: MaintainPayout[] = [];

    for (const b of mine) {
      if (FUNDED.includes(b.status) && deps.fundings) {
        for (const f of await deps.fundings.listByBounty(b.id)) {
          if (f.status === "paid" && f.rail === "lightning") {
            fundedSats += f.sourceAmount;
            satsKnown = true;
          }
        }
      }
      const needsSub = REVIEW.includes(b.status) || b.status in PAYOUT_STATUS;
      const sub = needsSub ? await repo.currentSubmission(b.id) : undefined;
      const claimant = needsSub ? await repo.activeClaimant(b.id) : undefined;

      if (REVIEW.includes(b.status)) {
        const merged = Boolean(sub?.mergedAt);
        const report = sub?.report ?? null;
        queue.push({
          bountyId: b.id,
          repoFullName: b.repoFullName,
          issueNumber: b.issueNumber,
          issueTitle: b.issueTitle,
          amountXof: b.amountXof,
          status: b.status,
          prNumber: sub?.prNumber ?? b.prNumber ?? null,
          prUrl: sub || b.prNumber ? `https://github.com/${b.repoFullName}/pull/${sub?.prNumber ?? b.prNumber}` : null,
          developer: sub?.authorLogin ?? claimant?.login ?? null,
          verdict: sub?.verdict ?? b.verdict,
          summary: report?.summary ?? null,
          criteria: report
            ? report.criteria.map((r) => ({ text: r.text, met: r.met, evidence: r.evidence || null }))
            : b.criteria.map((cr) => ({ text: cr.text, met: null, evidence: null })),
          ci: ciOf(b, merged),
          merged,
          canPay: canTransition(b.status, "maintainer.pay"),
          canHold: canTransition(b.status, "maintainer.hold"),
        });
      }

      const payoutStatus = PAYOUT_STATUS[b.status];
      if (payoutStatus) {
        const p = deps.payouts ? await deps.payouts.getByBounty(b.id) : undefined;
        if (p?.paidAt && b.status === "paid") {
          if (Date.parse(p.paidAt) >= monthStart) {
            paidThisMonthXof += p.amountXof;
            paidThisMonthCount++;
          }
          if (sub?.mergedAt) minutes.push(Math.max(0, Math.round((Date.parse(p.paidAt) - Date.parse(sub.mergedAt)) / 60_000)));
        }
        payouts.push({
          bountyId: b.id,
          repoFullName: b.repoFullName,
          issueNumber: b.issueNumber,
          issueTitle: b.issueTitle,
          developer: (p ? loginOf(p.userId) : null) ?? claimant?.login ?? null,
          amountXof: p?.amountXof ?? b.amountXof,
          amountSats: p?.amountSats ?? null,
          status: payoutStatus,
          reason: payoutStatus === "failed" && p?.lastError ? publicPayoutReason(p.lastError) : null,
          receiptId: p?.status === "succeeded" ? p.id : null,
          at: p?.paidAt ?? null,
        });
      }
    }

    const byRepo = new Map<string, Bounty[]>();
    for (const r of installed) byRepo.set(r, []);
    for (const b of mine) {
      const key = [...byRepo.keys()].find((k) => k.toLowerCase() === b.repoFullName.toLowerCase()) ?? b.repoFullName;
      byRepo.set(key, [...(byRepo.get(key) ?? []), b]);
    }

    const agents = await Promise.all(
      myAgents.map(async (a) => {
        const v = await deps.agents!.budget(a);
        return {
          name: v.agent,
          monthlyBudgetXof: v.monthly_budget_xof,
          committedThisMonthXof: v.committed_this_month_xof,
          remainingXof: v.remaining_xof,
          perTaskMaxXof: v.per_task_max_xof,
          allowedRepos: v.allowed_repos,
        };
      }),
    );

    // Most urgent first: on hold, then PRs in, then verified (only Hold left to do).
    const rank: Partial<Record<BountyStatus, number>> = { on_hold: 0, submitted: 1, verified: 2 };
    queue.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));
    payouts.sort((a, b) => (b.at ?? "9999").localeCompare(a.at ?? "9999"));

    return {
      maintainer: login ?? "maintainer",
      summary: {
        fundedXof: mine.filter((b) => FUNDED.includes(b.status)).reduce((s, b) => s + b.amountXof, 0),
        fundedSats: satsKnown ? fundedSats : null,
        atStakeXof: mine.filter((b) => AT_STAKE.includes(b.status)).reduce((s, b) => s + b.amountXof, 0),
        paidThisMonthXof,
        paidThisMonthCount,
        medianMinutesMergeToPay: minutes.length ? median(minutes) : null,
      },
      queue,
      repos: [...byRepo].map(([fullName, bs]) => ({
        fullName,
        openBounties: bs.filter((b) => OPEN.includes(b.status)).length,
        paidCount: bs.filter((b) => b.status === "paid").length,
      })),
      payouts: payouts.slice(0, 20),
      agents,
    };
  }

  const decision = (action: "pay" | "hold") => async (c: Context) => {
    // Money moves here: a verified session is required, even when the read side is open (auth off).
    const login = userFrom(c);
    if (!login) return c.json({ error: "unauthorized" }, 401);
    const bounty = await repo.findById(c.req.param("id") ?? "");
    if (!bounty) return c.json({ error: "bounty_not_found" }, 404);
    if (!deps.decide) return c.json({ error: "github_not_configured", hint: "Pay / Hold need the GitHub App (GITHUB_APP_ID)" }, 503);
    const body = (await c.req.json().catch(() => null)) as { note?: unknown } | null;
    const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;
    let writer: GithubWriter;
    try {
      writer = await deps.decide.writerForRepo(bounty.repoFullName);
    } catch {
      return c.json({ error: "github_unavailable" }, 502);
    }
    const d: MaintainerDecision = action === "pay" ? { name: "pay" } : { name: "hold", note };
    const out = await runMaintainerDecision(deps.decide.wiring, {
      writer,
      repoName: bounty.repoFullName,
      issueNumber: bounty.issueNumber,
      login,
      decision: d,
    });
    if (out.kind === "forbidden") return c.json({ error: "forbidden", message: out.message }, 403);
    if (out.kind === "replied") return c.json({ error: "not_allowed_now", message: out.message }, 409);
    if (out.kind === "ignored") return c.json({ error: "ignored", message: out.reason }, 409);
    return c.json({ bountyId: out.bounty.id, status: out.bounty.status });
  };

  api.post("/api/maintain/bounties/:id/pay", decision("pay"));
  api.post("/api/maintain/bounties/:id/hold", decision("hold"));

  return api;
}

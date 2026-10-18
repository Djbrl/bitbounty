// U4: the maintainer home's data (GET /api/maintain), its words (FR/EN) and the fixtures fallback.
// Pure: no React, no fetch.
import type { BountyDetail, BountyStatus, Dashboard } from "../../../../fixtures/types";
import type { Lang } from "../app-shell/mode";

export type CiState = "success" | "failure" | "pending" | "unknown";
export type PayoutReason = "unreachable" | "expired" | "rejected" | "setup" | "no_account" | "wallet_unreachable" | "wallet_refused" | "other";

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
  verdict: "pass" | "fail" | "unsure" | null;
  summary: string | null;
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
  reason: PayoutReason | null;
  receiptId: string | null;
  at: string | null;
}

export interface MaintainAgent {
  name: string;
  monthlyBudgetXof: number;
  committedThisMonthXof: number;
  remainingXof: number;
  perTaskMaxXof: number;
  allowedRepos: string[];
}

/** GET /api/maintain (apps/server/src/api/maintain.ts). */
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
  agents: MaintainAgent[];
}

export type Decision = "pay" | "hold";
export type DecisionResult = { ok: true; status: BountyStatus } | { ok: false; error: string; message?: string };

const FUNDED: readonly BountyStatus[] = ["funded", "claimed", "submitted", "verified", "paying", "on_hold", "payout_failed", "paid"];
const AT_STAKE: readonly BountyStatus[] = ["funded", "claimed", "submitted", "verified", "paying", "on_hold", "payout_failed"];
const OPEN: readonly BountyStatus[] = ["unfunded", ...AT_STAKE];
const REVIEW: readonly BountyStatus[] = ["on_hold", "submitted", "verified"];
const PAYOUT_STATUS: Partial<Record<BountyStatus, MaintainPayout["status"]>> = { paying: "paying", paid: "paid", payout_failed: "failed" };

/** Same rule as the server's `ciOf`: only what the status proves. */
function ciOf(status: BountyStatus, verdict: ReviewItem["verdict"], merged: boolean): CiState {
  if (!merged) return "pending";
  if (status === "verified") return "success";
  if (status === "on_hold" && verdict === "pass") return "failure";
  return "unknown";
}

/** The fixtures' raw payout errors, reduced to a public reason like the server does (I3). Never shown raw. */
function reasonOf(raw: string | null | undefined): PayoutReason | null {
  if (!raw) return null;
  const e = raw.toLowerCase();
  if (e.startsWith("lnurl unreachable")) return "wallet_unreachable";
  if (e.startsWith("lnurl refused")) return "wallet_refused";
  if (e.includes("no payout account") || e.includes("no lightning address")) return "no_account";
  if (e.includes("expired")) return "expired";
  return "other";
}

/** Fixtures mode: the same view the server computes, from bounties.json + dashboard.json. */
export function mockHome(bounties: BountyDetail[], dashboard: Dashboard, now = new Date()): MaintainHome {
  const ids = new Set(dashboard.bountyIds);
  const mine = bounties.filter((b) => ids.has(b.id));
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const minutes: number[] = [];
  let sats = 0;
  let satsKnown = false;
  let paidXof = 0;
  let paidCount = 0;
  const queue: ReviewItem[] = [];
  const payouts: MaintainPayout[] = [];
  for (const b of mine) {
    if (FUNDED.includes(b.status)) {
      for (const f of b.fundings ?? []) {
        if (f.status === "paid" && f.rail === "lightning") {
          sats += f.sourceAmount;
          satsKnown = true;
        }
      }
    }
    const sub = b.submission;
    if (REVIEW.includes(b.status)) {
      const merged = Boolean(sub?.mergedAt);
      const verdict = sub?.verdict ?? b.verdict;
      queue.push({
        bountyId: b.id,
        repoFullName: b.repoFullName,
        issueNumber: b.issueNumber,
        issueTitle: b.issueTitle,
        amountXof: b.amountXof,
        status: b.status,
        prNumber: sub?.prNumber ?? null,
        prUrl: sub?.prUrl ?? null,
        developer: sub?.authorLogin ?? b.claims[0]?.userLogin ?? null,
        verdict,
        summary: sub?.report?.summary ?? null,
        criteria: sub?.report
          ? sub.report.criteria.map((c) => ({ text: c.text, met: c.met, evidence: c.evidence || null }))
          : b.criteria.map((c) => ({ text: c.text, met: null, evidence: null })),
        ci: ciOf(b.status, verdict, merged),
        merged,
        canPay: b.status === "submitted" || b.status === "on_hold",
        canHold: b.status === "submitted" || b.status === "verified",
      });
    }
    const ps = PAYOUT_STATUS[b.status];
    if (ps) {
      const p = b.payout;
      if (p?.paidAt && b.status === "paid") {
        if (Date.parse(p.paidAt) >= monthStart) {
          paidXof += p.amountXof;
          paidCount++;
        }
        if (sub?.mergedAt) minutes.push(Math.max(0, Math.round((Date.parse(p.paidAt) - Date.parse(sub.mergedAt)) / 60_000)));
      }
      payouts.push({
        bountyId: b.id,
        repoFullName: b.repoFullName,
        issueNumber: b.issueNumber,
        issueTitle: b.issueTitle,
        developer: p?.userLogin ?? sub?.authorLogin ?? null,
        amountXof: p?.amountXof ?? b.amountXof,
        amountSats: p?.amountSats ?? null,
        status: ps,
        reason: ps === "failed" ? reasonOf(p?.lastError) : null,
        receiptId: p?.status === "succeeded" ? p.id : null,
        at: p?.paidAt ?? null,
      });
    }
  }
  const byRepo = new Map<string, BountyDetail[]>(dashboard.repos.map((r) => [r.fullName, []]));
  for (const b of mine) byRepo.set(b.repoFullName, [...(byRepo.get(b.repoFullName) ?? []), b]);
  const rank: Partial<Record<BountyStatus, number>> = { on_hold: 0, submitted: 1, verified: 2 };
  queue.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));
  const sorted = [...minutes].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return {
    maintainer: dashboard.maintainer,
    summary: {
      fundedXof: mine.filter((b) => FUNDED.includes(b.status)).reduce((s, b) => s + b.amountXof, 0),
      fundedSats: satsKnown ? sats : null,
      atStakeXof: mine.filter((b) => AT_STAKE.includes(b.status)).reduce((s, b) => s + b.amountXof, 0),
      paidThisMonthXof: paidXof,
      paidThisMonthCount: paidCount,
      medianMinutesMergeToPay: sorted.length ? (sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)) : null,
    },
    queue,
    repos: [...byRepo].map(([fullName, bs]) => ({
      fullName,
      openBounties: bs.filter((b) => OPEN.includes(b.status)).length,
      paidCount: bs.filter((b) => b.status === "paid").length,
    })),
    payouts,
    agents: [{ name: "claude-code", monthlyBudgetXof: 50_000, committedThisMonthXof: 12_000, remainingXof: 38_000, perTaskMaxXof: 15_000, allowedRepos: ["Djbrl/bitbounty-demo"] }],
  };
}

/** "6 min", "2 h 05", "3 j" / "3 d". */
export function formatMinutes(min: number | null, lang: Lang): string {
  if (min === null) return "—";
  if (min < 60) return `${min} min`;
  if (min < 48 * 60) return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
  return `${Math.round(min / 1440)} ${lang === "fr" ? "j" : "d"}`;
}

/** True when nothing is installed or funded yet: the page shows its empty state. */
export const isEmptyHome = (h: MaintainHome) => !h.repos.length && !h.queue.length && !h.payouts.length;

const T = {
  fr: {
    title: "Espace maintainer",
    funded: "Financé",
    atStake: "En jeu",
    atStakeSub: "réservé pour les bounties ouvertes",
    paidMonth: "Payé ce mois-ci",
    paidMonthSub: (n: number) => `${n} paiement${n > 1 ? "s" : ""}`,
    median: "Fusion → paiement",
    medianSub: "temps médian",
    fundedSub: (sats: string | null) => (sats ? `${sats} reçus en Lightning` : "sur toutes vos bounties"),
    review: "À relire",
    reviewDesc: "Les PR liées à vos bounties. Claude vérifie chaque critère ; vous décidez.",
    reviewEmpty: "Rien à décider",
    reviewEmptyBody: "Quand un développeur ouvre une PR sur une issue financée, elle arrive ici avec l'avis de Claude.",
    criteria: "Critères (avis de Claude)",
    noReport: "Claude n'a pas encore rendu son avis.",
    ci: { success: "CI verte", failure: "CI rouge", pending: "CI en cours", unknown: "CI ?" } as Record<CiState, string>,
    verdict: { pass: "Claude : tout est bon", fail: "Claude : critères manquants", unsure: "Claude : incertain" },
    merged: "Fusionnée",
    by: "par",
    pay: "Payer",
    hold: "Bloquer",
    confirmPay: (amount: string, who: string) => `Payer ${amount} à @${who} ? Les sats partent en Lightning après la fenêtre d'objection.`,
    confirmHold: "Bloquer ce paiement ? Rien ne part tant que vous n'avez pas payé.",
    holdNote: "Raison (optionnelle, visible sur l'issue)",
    confirm: "Confirmer",
    cancel: "Annuler",
    sameAsGithub: "Même effet que /pay et /hold sur l'issue.",
    done: { pay: "Paiement approuvé", hold: "Paiement bloqué" },
    failed: "Action refusée",
    errors: {
      forbidden: "Il faut un accès en écriture sur ce dépôt.",
      unauthorized: "Session expirée. Reconnectez-vous avec GitHub.",
      not_allowed_now: "Le statut de la bounty a changé : rechargez la page.",
      github_not_configured: "L'app GitHub n'est pas configurée sur ce serveur.",
      default: "Le serveur n'a pas pu appliquer l'action. Réessayez.",
    } as Record<string, string>,
    repos: "Dépôts",
    reposDesc: "Les dépôts où l'app BitBounty est installée.",
    openBounties: (n: number) => `${n} bounty${n > 1 ? "s" : ""} ouverte${n > 1 ? "s" : ""}`,
    paidCount: (n: number) => `${n} payée${n > 1 ? "s" : ""}`,
    installMore: "Installer sur d'autres dépôts",
    backlog: "Chiffrer mon backlog",
    backlogDesc: "Claude lit vos issues ouvertes et propose un prix et des critères pour chacune.",
    backlogRun: "Chiffrer",
    backlogRunning: "Claude lit les issues…",
    backlogLast: "Dernières suggestions",
    backlogNone: "Aucune suggestion pour ce dépôt.",
    backlogError: "Impossible de chiffrer ce dépôt pour l'instant.",
    repo: "Dépôt",
    payouts: "Paiements",
    payoutsDesc: "En sats sur la Lightning Address du développeur.",
    payoutsEmpty: "Aucun paiement pour l'instant",
    payoutsEmptyBody: "Dès qu'une PR fusionnée est payée, le reçu apparaît ici.",
    payoutStatus: { paying: "En cours", paid: "Payé", failed: "Échoué" },
    receipt: "Reçu",
    reasons: {
      unreachable: "Le service de paiement ne répond pas, nouvel essai automatique.",
      expired: "La facture a expiré, nouvel essai automatique.",
      rejected: "Paiement refusé par le service de paiement.",
      setup: "Problème de configuration côté BitBounty.",
      no_account: "Le développeur n'a pas encore relié sa Lightning Address.",
      wallet_unreachable: "Le portefeuille du développeur ne répond pas.",
      wallet_refused: "Le portefeuille du développeur a refusé le paiement.",
      other: "Le paiement a échoué.",
    } as Record<PayoutReason, string>,
    agents: "Agents",
    agentsDesc: "Clés d'agent et budgets du mois (lecture seule).",
    budget: "Budget du mois",
    left: "restant",
    perTask: "max par tâche",
    emptyTitle: "Pas encore de dépôt",
    emptyBody: "Installez l'app BitBounty sur un dépôt, chiffrez votre backlog et financez une issue.",
    install: "Installer sur GitHub",
  },
  en: {
    title: "Maintainer home",
    funded: "Funded",
    atStake: "At stake",
    atStakeSub: "held for open bounties",
    paidMonth: "Paid this month",
    paidMonthSub: (n: number) => `${n} payout${n === 1 ? "" : "s"}`,
    median: "Merge → paid",
    medianSub: "median time",
    fundedSub: (sats: string | null) => (sats ? `${sats} received over Lightning` : "across your bounties"),
    review: "Review queue",
    reviewDesc: "PRs linked to your bounties. Claude checks each criterion; you decide.",
    reviewEmpty: "Nothing to decide",
    reviewEmptyBody: "When a developer opens a PR on a funded issue, it lands here with Claude's verdict.",
    criteria: "Criteria (Claude's verdict)",
    noReport: "Claude hasn't reported yet.",
    ci: { success: "CI green", failure: "CI red", pending: "CI running", unknown: "CI ?" } as Record<CiState, string>,
    verdict: { pass: "Claude: all met", fail: "Claude: criteria missing", unsure: "Claude: unsure" },
    merged: "Merged",
    by: "by",
    pay: "Pay",
    hold: "Hold",
    confirmPay: (amount: string, who: string) => `Pay ${amount} to @${who}? The sats go out over Lightning after the objection window.`,
    confirmHold: "Hold this payout? Nothing goes out until you pay.",
    holdNote: "Reason (optional, shown on the issue)",
    confirm: "Confirm",
    cancel: "Cancel",
    sameAsGithub: "Same as /pay and /hold on the issue.",
    done: { pay: "Payout approved", hold: "Payout on hold" },
    failed: "Action refused",
    errors: {
      forbidden: "You need write access on this repo.",
      unauthorized: "Session expired. Sign in again with GitHub.",
      not_allowed_now: "The bounty changed: reload the page.",
      github_not_configured: "The GitHub App isn't configured on this server.",
      default: "The server couldn't apply it. Try again.",
    } as Record<string, string>,
    repos: "Repos",
    reposDesc: "Repos where the BitBounty app is installed.",
    openBounties: (n: number) => `${n} open bount${n === 1 ? "y" : "ies"}`,
    paidCount: (n: number) => `${n} paid`,
    installMore: "Install on more repos",
    backlog: "Price my backlog",
    backlogDesc: "Claude reads your open issues and suggests a price and criteria for each.",
    backlogRun: "Price it",
    backlogRunning: "Claude is reading the issues…",
    backlogLast: "Last suggestions",
    backlogNone: "No suggestion for this repo.",
    backlogError: "Couldn't price this repo right now.",
    repo: "Repo",
    payouts: "Payouts",
    payoutsDesc: "In sats, to the developer's Lightning Address.",
    payoutsEmpty: "No payout yet",
    payoutsEmptyBody: "Once a merged PR is paid, its receipt shows up here.",
    payoutStatus: { paying: "Paying", paid: "Paid", failed: "Failed" },
    receipt: "Receipt",
    reasons: {
      unreachable: "The payment service isn't answering, retrying automatically.",
      expired: "The invoice expired, retrying automatically.",
      rejected: "The payment service refused the payout.",
      setup: "A setup problem on BitBounty's side.",
      no_account: "The developer hasn't linked a Lightning Address yet.",
      wallet_unreachable: "The developer's wallet isn't answering.",
      wallet_refused: "The developer's wallet refused the payment.",
      other: "The payout failed.",
    } as Record<PayoutReason, string>,
    agents: "Agents",
    agentsDesc: "Agent keys and this month's budgets (read-only).",
    budget: "Monthly budget",
    left: "left",
    perTask: "max per task",
    emptyTitle: "No repo yet",
    emptyBody: "Install the BitBounty app on a repo, price your backlog and fund an issue.",
    install: "Install on GitHub",
  },
} as const;

export type MaintainText = (typeof T)[Lang];
export const maintainText = (lang: Lang): MaintainText => T[lang];

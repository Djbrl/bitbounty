import type {
  Bounty,
  BountyStatus,
  CriterionResult,
  FundingRail,
  PayoutProvider,
} from "@bitbounty/core";
import { COPY, type Copy } from "./copy.js";
import { encodeSegment, escapeInline, markerSafe, mention } from "./escape.js";
import { formatDate, formatSats, formatXof, type Lang } from "./format.js";

export type { Lang } from "./format.js";

/** Everything the comment shows that isn't on the `Bounty` row. All optional except the base URL. */
export interface StatusCommentExtras {
  /** Web app origin, e.g. `https://bitbounty.app`. Links: /pay/[id], /b/[id], /r/[id], /me. */
  baseUrl: string;
  /** Sats actually received (shown once funded). */
  fundedSats?: number | null;
  fundingRail?: FundingRail | null;
  fundedAt?: string | null;
  /** The active claim. */
  claim?: { login: string; expiresAt: string } | null;
  /** The linked PR. */
  pr?: { number: number; authorLogin?: string | null } | null;
  /** Latest verification report; the verdict itself is read from `bounty.verdict`. */
  report?: { summary: string; criteria?: CriterionResult[]; riskFlags?: string[] } | null;
  /** End of the objection window once verified. */
  objectionEndsAt?: string | null;
  payout?: {
    /** Receipt page id, links to /r/[receiptId]. */
    receiptId?: string | null;
    provider?: PayoutProvider | null;
    reference?: string | null;
    lastError?: string | null;
    attempts?: number | null;
  } | null;
  /** Free text from `/hold <reason>` or the system (e.g. "merged with red CI"). */
  holdReason?: string | null;
}

/** Limits that keep a hostile issue from producing a 65 KB comment. */
export const LIMITS = { title: 120, criterion: 280, criteria: 10, summary: 500, reason: 280, error: 200 };

const MARKER_PREFIX = "<!-- bitbounty:status ";

/** The hidden first line G3 searches for to find and edit the bot's comment. */
export function statusMarker(bountyId: string): string {
  return `${MARKER_PREFIX}${markerSafe(bountyId)} -->`;
}

/** True when `body` is the status comment for `bountyId`. */
export function isStatusComment(body: string | null | undefined, bountyId: string): boolean {
  return typeof body === "string" && body.includes(statusMarker(bountyId));
}

/** Index of the step the bounty is working towards (0 = Funded … 4 = Paid). */
const CURRENT_STEP: Partial<Record<BountyStatus, number>> = {
  unfunded: 0,
  funded: 1,
  claimed: 2,
  submitted: 3,
  on_hold: 3,
  verified: 4,
  paying: 4,
  payout_failed: 4,
  paid: 5,
};

function isCount(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0;
}

function normalizeBase(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`renderStatusComment: invalid baseUrl ${JSON.stringify(baseUrl)}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`renderStatusComment: baseUrl must be http(s), got ${url.protocol}`);
  }
  return url.toString().replace(/\/+$/, "");
}

function progressLine(status: BountyStatus, c: Copy): string | null {
  const current = CURRENT_STEP[status];
  if (current === undefined) return null;
  const blocked = status === "on_hold" ? "⏸" : status === "payout_failed" ? "⚠️" : "●";
  return c.steps
    .map((label, i) => {
      if (i < current) return `✓ ${label}`;
      if (i === current) return `${blocked} **${label}**`;
      return `○ ${label}`;
    })
    .join(" · ");
}

function criteriaBlock(bounty: Bounty, extras: StatusCommentExtras, c: Copy): string[] {
  const list = Array.isArray(bounty.criteria) ? bounty.criteria : [];
  if (list.length === 0) return [c.noCriteria];
  const results = bounty.status === "submitted" || bounty.status === "on_hold" ? extras.report?.criteria : undefined;
  const lines = list.slice(0, LIMITS.criteria).map((cr, i) => {
    const r = results?.[i];
    const box = r === undefined ? "☐" : r.met ? "✅" : "❌";
    // A plain glyph, not "- [ ]": task-list boxes would let any writer tick the bot's comment.
    return `- ${box} ${escapeInline(cr.text, LIMITS.criterion)}`;
  });
  if (list.length > LIMITS.criteria) lines.push(c.moreCriteria(list.length - LIMITS.criteria));
  return lines;
}

function prLink(repoFullName: string, prNumber: number): string {
  const ok = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repoFullName);
  return ok ? `[PR #${prNumber}](https://github.com/${repoFullName}/pull/${prNumber})` : `PR #${prNumber}`;
}

/**
 * Markdown for the single status comment the bot keeps editing on the issue.
 * Pure: same input, same output, no clock, no I/O. Every piece of user text is escaped.
 */
export function renderStatusComment(bounty: Bounty, extras: StatusCommentExtras, lang: Lang): string {
  const c = COPY[lang] ?? COPY.en;
  const base = normalizeBase(extras.baseUrl);
  const id = encodeSegment(bounty.id);
  const status = bounty.status;
  const amount = formatXof(bounty.amountXof);
  const issue = `#${bounty.issueNumber}`;
  const hasCriteria = Array.isArray(bounty.criteria) && bounty.criteria.length > 0;
  const meUrl = `${base}/me`;

  const claimant = extras.claim?.login ? mention(extras.claim.login) : null;
  const author = extras.pr?.authorLogin ? mention(extras.pr.authorLogin) : null;
  const dev = claimant ?? author ?? "—";
  const pr = isCount(extras.pr?.number) ? prLink(bounty.repoFullName, extras.pr.number) : null;
  const provider = extras.payout?.provider ? c.provider[extras.payout.provider] : "Mobile Money";

  const out: string[] = [statusMarker(bounty.id)];
  out.push(`### 💰 ${amount} · ${c.pill[status]}`);
  out.push(c.issueLine(issue, escapeInline(bounty.issueTitle, LIMITS.title)));

  const progress = progressLine(status, c);
  if (progress) out.push(progress);

  if (status !== "refunded" && status !== "cancelled") out.push(criteriaBlock(bounty, extras, c).join("\n"));

  const body: string[] = [];
  switch (status) {
    case "unfunded":
      body.push(`**[${c.fundCta}](${base}/pay/${id})**`);
      break;
    case "funded":
      body.push(
        c.fundedHeld(
          amount,
          isCount(extras.fundedSats) ? formatSats(extras.fundedSats) : null,
          extras.fundingRail ? c.rail[extras.fundingRail] : null,
          extras.fundedAt ? formatDate(extras.fundedAt, lang) : null,
        ),
      );
      break;
    case "claimed":
      body.push(c.claimedBy(dev, extras.claim?.expiresAt ? formatDate(extras.claim.expiresAt, lang) : "—"));
      break;
    case "submitted":
    case "on_hold": {
      if (pr) body.push(c.submitted(pr, author ?? claimant));
      const verdictLines: string[] = [bounty.verdict ? c.verdict[bounty.verdict] : c.verdictPending];
      if (bounty.verdict && extras.report?.summary) {
        verdictLines.push(`> ${escapeInline(extras.report.summary, LIMITS.summary)}`);
      }
      const flags = (extras.report?.riskFlags ?? []).filter((f) => typeof f === "string" && f.trim());
      if (bounty.verdict && flags.length > 0) {
        verdictLines.push(c.riskFlags(flags.slice(0, 5).map((f) => escapeInline(f, 60)).join(", ")));
      }
      verdictLines.push(c.verdictNote);
      body.push(...verdictLines);
      if (status === "on_hold") {
        body.push(c.onHold);
        if (extras.holdReason) body.push(c.holdReason(escapeInline(extras.holdReason, LIMITS.reason)));
      }
      break;
    }
    case "verified":
      if (pr) body.push(c.submitted(pr, author ?? claimant));
      body.push(c.validated(extras.objectionEndsAt ? formatDate(extras.objectionEndsAt, lang) : null));
      break;
    case "paying":
      body.push(c.paying(amount, dev, provider));
      break;
    case "paid": {
      const parts = [c.paid(amount, dev, provider)];
      if (extras.payout?.reference) {
        // Shown in a code span, where escapes don't work: keep only reference-safe chars.
        const ref = extras.payout.reference.replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 64);
        if (ref) parts.push(c.reference(ref));
      }
      if (extras.payout?.receiptId) parts.push(`**[${c.receipt}](${base}/r/${encodeSegment(extras.payout.receiptId)})**`);
      body.push(parts.join(" · "));
      break;
    }
    case "payout_failed":
      body.push(c.payoutFailed(dev));
      if (extras.payout?.lastError) {
        const attempts = isCount(extras.payout.attempts) ? extras.payout.attempts : null;
        body.push(c.lastError(escapeInline(extras.payout.lastError, LIMITS.error), attempts));
      }
      break;
    case "refunded":
      body.push(c.refunded(amount));
      break;
    case "cancelled":
      body.push(c.cancelled);
      break;
  }
  out.push(...body);

  out.push(`${c.nextLabel} ${nextAction(status, { c, hasCriteria, dev, issue, pr, meUrl, verdict: bounty.verdict })}`);

  out.push(`<sub>${c.footer} · [${c.bountyPage}](${base}/b/${id})</sub>`);
  return out.join("\n\n") + "\n";
}

function nextAction(
  status: BountyStatus,
  ctx: { c: Copy; hasCriteria: boolean; dev: string; issue: string; pr: string | null; meUrl: string; verdict: Bounty["verdict"] },
): string {
  const { c, hasCriteria, dev, issue, meUrl } = ctx;
  const pr = ctx.pr ?? "PR";
  switch (status) {
    case "unfunded":
      return hasCriteria ? c.next.unfunded : c.next.unfundedNoCriteria;
    case "funded":
      return hasCriteria ? c.next.funded(meUrl) : c.next.fundedNoCriteria;
    case "claimed":
      return c.next.claimed(dev, issue);
    case "submitted":
      return ctx.verdict ? c.next.submitted(pr) : c.next.submittedPending(pr);
    case "verified":
      return c.next.verified;
    case "paying":
      return c.next.paying;
    case "paid":
      return c.next.paid(dev);
    case "on_hold":
      return c.next.onHold;
    case "payout_failed":
      return c.next.payoutFailed(dev, meUrl);
    case "refunded":
    case "cancelled":
      return c.next.closed;
  }
}

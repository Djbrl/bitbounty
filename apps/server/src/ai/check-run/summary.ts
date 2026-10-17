import type { VerificationReport, Verdict } from "@bitbounty/core";
import type { VerifyCi } from "../verifier/index.js";
import type { CheckConclusion, CheckRunOutput } from "./types.js";

/** GitHub caps `output.summary` at 65535 chars. */
const MAX_SUMMARY = 60_000;
const MAX_EVIDENCE = 600;

/** pass → success, fail → failure, unsure → neutral (never a false failure). */
export function conclusionFor(verdict: Verdict): CheckConclusion {
  if (verdict === "pass") return "success";
  if (verdict === "fail") return "failure";
  return "neutral";
}

const ADVICE =
  "> **This is advice, not approval.** A human maintainer decides: merge, `/pay`, `/hold` or `/reject`. " +
  "The verifier never moves money or changes the bounty by itself.";

/**
 * Model and PR text are untrusted: flatten to one line, escape HTML/markdown that could
 * hide or fake content, and break @mentions and #refs so the check never pings anyone.
 */
export function sanitize(text: string, max = MAX_EVIDENCE): string {
  let t = text.replace(/\s+/g, " ").trim();
  if (t.length > max) t = t.slice(0, max - 1) + "…";
  return t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\`*_[\]!|])/g, "\\$1")
    .replace(/@(?=[A-Za-z0-9])/g, "@​")
    .replace(/#(?=\d)/g, "#​");
}

export interface SummaryContext {
  bountyId: string;
  issueNumber: number;
  headSha: string;
  ci: VerifyCi;
  verifierName: string;
}

const VERDICT_LABEL: Record<Verdict, string> = {
  pass: "Pass: every criterion looks met",
  fail: "Fail: some criteria look unmet",
  unsure: "Unsure: a human needs to look",
};

export function renderReport(report: VerificationReport, ctx: SummaryContext): CheckRunOutput {
  const lines: string[] = [];
  lines.push(`**Verdict: ${VERDICT_LABEL[report.verdict]}**`, "", ADVICE, "");
  lines.push(`Bounty \`${ctx.bountyId.replace(/[`\s]/g, "").slice(0, 80)}\` · issue #${ctx.issueNumber} · commit \`${ctx.headSha.slice(0, 7)}\``);
  lines.push(`CI: ${ctx.ci.status} · verifier: ${sanitize(ctx.verifierName, 80)}`, "");
  lines.push(`### Summary`, "", sanitize(report.summary, 1_500), "");
  lines.push(`### Criteria`, "");
  if (report.criteria.length === 0) lines.push("_No acceptance criteria on the issue._");
  report.criteria.forEach((c, i) => {
    lines.push(`${i + 1}. ${c.met ? "✅ Met" : "❌ Not met"}: ${sanitize(c.text, 300)}`);
    lines.push(`   - Evidence: ${sanitize(c.evidence) || "_none given_"}`);
  });
  if (report.riskFlags.length) {
    lines.push("", "### Risk flags", "");
    for (const f of report.riskFlags) lines.push(`- ${sanitize(f, 200)}`);
  }
  return { title: VERDICT_LABEL[report.verdict], summary: cap(lines.join("\n")) };
}

export function renderInProgress(issueNumber: number): CheckRunOutput {
  return {
    title: "Checking the PR against the bounty criteria…",
    summary: `Claude is reading this commit's diff against the criteria of issue #${issueNumber}.\n\n${ADVICE}`,
  };
}

export function renderSuperseded(newSha: string): CheckRunOutput {
  return {
    title: "Superseded by a newer push",
    summary: `A newer commit (\`${newSha.slice(0, 7)}\`) was pushed; only the latest commit is verified.\n\n${ADVICE}`,
  };
}

/** Infrastructure problem (diff unreadable, crash): neutral, never a false failure. */
export function renderError(reason: string): CheckRunOutput {
  return {
    title: "Verifier unavailable: a human needs to look",
    summary: `The verification could not run: ${sanitize(reason, 300)}\n\nThis says nothing about the PR's quality.\n\n${ADVICE}`,
  };
}

function cap(s: string): string {
  return s.length <= MAX_SUMMARY ? s : s.slice(0, MAX_SUMMARY) + "\n\n_[summary truncated]_";
}

interface CheckRunLike {
  name: string;
  status: string;
  conclusion: string | null;
}

const OK = new Set(["success", "neutral", "skipped"]);

/** Folds GitHub check runs + the combined commit status into the verifier's CI input. */
export function summarizeCi(
  checkRuns: CheckRunLike[],
  combined: { state: string; total_count: number } | null,
  ownName: string,
): VerifyCi {
  const runs = checkRuns.filter((r) => r.name !== ownName);
  const checks = runs.map((r) => `${r.name}: ${r.status === "completed" ? r.conclusion : r.status}`);
  const hasStatuses = !!combined && combined.total_count > 0;
  if (runs.length === 0 && !hasStatuses) return { status: "unknown", checks };
  const failed =
    runs.some((r) => r.status === "completed" && !OK.has(r.conclusion ?? "")) ||
    (hasStatuses && (combined!.state === "failure" || combined!.state === "error"));
  if (failed) return { status: "failure", checks };
  const pending = runs.some((r) => r.status !== "completed") || (hasStatuses && combined!.state === "pending");
  return { status: pending ? "pending" : "success", checks };
}

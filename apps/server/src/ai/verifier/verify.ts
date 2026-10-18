import { AnthropicVerifierClient, DEFAULT_VERIFIER_MODEL, isRetryable } from "./anthropic-client.js";
import { DEFAULT_MAX_DIFF_CHARS, truncateDiff } from "./diff.js";
import { HeuristicVerifierClient } from "./fake-client.js";
import { SYSTEM_PROMPT, buildUserPrompt, detectInjection } from "./prompt.js";
import { modelAnswerJsonSchema, parseModelAnswer } from "./schema.js";
import type { VerificationReport, Verdict, VerifierClient, VerifyInput } from "./types.js";

export interface VerifyOptions {
  client?: VerifierClient;
  maxDiffChars?: number;
  /** Per-attempt timeout (ms). */
  timeoutMs?: number;
  /** Extra attempts after the first, for transient errors only. */
  retries?: number;
  /** Base backoff between attempts (ms), doubled each time. */
  backoffMs?: number;
}

/** Real client when ANTHROPIC_API_KEY is set, otherwise the offline heuristic fake. */
export function createVerifierClient(env: NodeJS.ProcessEnv = process.env): VerifierClient {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return new HeuristicVerifierClient();
  return new AnthropicVerifierClient({ apiKey, model: env.VERIFIER_MODEL?.trim() || DEFAULT_VERIFIER_MODEL });
}

/**
 * Check a PR diff against the issue's criteria. Returns a VerificationReport (F2).
 *
 * It is a signal only: it never changes a bounty's status. The caller (A2) publishes
 * the check run and emits `verify.done` with `report.verdict`.
 *
 * Never throws for model problems: invalid JSON, schema mismatch, inconsistent
 * answers, timeouts and API errors all become `unsure`.
 */
export async function verify(input: VerifyInput, opts: VerifyOptions = {}): Promise<VerificationReport> {
  const client = opts.client ?? createVerifierClient();
  const flags: string[] = [];
  if (client.isFake) flags.push(`offline fake verifier (${client.name})`);

  if (input.criteria.length === 0) {
    return { criteria: [], verdict: "unsure", summary: "The issue has no acceptance criteria to verify against.", riskFlags: [...flags, "no criteria"] };
  }
  if (input.diff.trim() === "") {
    return {
      criteria: input.criteria.map((c) => ({ text: c.text, met: false, evidence: "The PR diff is empty." })),
      verdict: "fail",
      summary: "The pull request changes nothing, so no criterion can be met.",
      riskFlags: [...flags, "empty diff"],
    };
  }

  const diff = truncateDiff(input.diff, opts.maxDiffChars ?? DEFAULT_MAX_DIFF_CHARS);
  if (diff.truncated) flags.push(`diff truncated (${diff.originalChars} chars, ${diff.omittedFiles.length} files omitted)`);
  const injection = detectInjection(input.diff, input.issue.title, input.issue.body);
  if (injection) flags.push("possible prompt injection in PR or issue text");

  let raw: string;
  try {
    raw = await callWithRetry(client, buildUserPrompt(input, diff), opts);
  } catch (err) {
    return unsure(input, `Verifier unavailable: ${errorMessage(err)}`, [...flags, "verifier error"]);
  }

  const answer = parseModelAnswer(raw);
  if (!answer) return unsure(input, "The verifier answer was not valid JSON matching the schema.", [...flags, "invalid verifier output"]);
  if (answer.criteria.length !== input.criteria.length) {
    return unsure(input, "The verifier did not answer every criterion exactly once.", [...flags, "invalid verifier output"]);
  }

  // Criterion text always comes from our input, never from the model.
  const criteria = input.criteria.map((c, i) => ({ text: c.text, met: answer.criteria[i]!.met, evidence: answer.criteria[i]!.evidence }));
  const riskFlags = dedupe([...flags, ...answer.risk_flags]);
  let verdict: Verdict = answer.verdict;
  let summary = answer.summary;

  // Consistency guards: `pass` must be earned.
  const allMet = criteria.every((c) => c.met);
  const downgrade = (why: string) => {
    verdict = "unsure";
    riskFlags.push(why);
    summary = `${summary} (Downgraded to unsure: ${why}.)`;
  };
  if (verdict === "pass" && !allMet) downgrade("verdict pass with unmet criteria");
  else if (verdict === "pass" && input.ci.status === "failure") downgrade("verdict pass while CI is failing");
  else if (verdict === "pass" && injection) downgrade("prompt injection suspected, needs a human");
  else if (verdict === "fail" && allMet) downgrade("verdict fail with every criterion met");

  return { criteria, verdict, summary, riskFlags: dedupe(riskFlags) };
}

async function callWithRetry(client: VerifierClient, user: string, opts: VerifyOptions): Promise<string> {
  const retries = opts.retries ?? 2;
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const backoff = opts.backoffMs ?? 1_000;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(backoff * 2 ** (attempt - 1));
    const ctrl = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ctrl.abort();
        reject(new Error(`timed out after ${timeoutMs} ms`));
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        client.complete({ system: SYSTEM_PROMPT, user, schema: modelAnswerJsonSchema, signal: ctrl.signal }),
        timeout,
      ]);
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err)) break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

function unsure(input: VerifyInput, summary: string, riskFlags: string[]): VerificationReport {
  return {
    criteria: input.criteria.map((c) => ({ text: c.text, met: false, evidence: "Not verified." })),
    verdict: "unsure",
    summary,
    riskFlags: dedupe(riskFlags),
  };
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}

function errorMessage(err: unknown): string {
  // Never echo request details; the SDK never puts the key in messages, but keep it short anyway.
  return (err instanceof Error ? err.message : String(err)).slice(0, 200);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

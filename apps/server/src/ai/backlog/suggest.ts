import { AnthropicVerifierClient, DEFAULT_VERIFIER_MODEL, isRetryable } from "../verifier/anthropic-client.js";
import { detectInjection } from "../verifier/prompt.js";
import type { VerifierClient } from "../verifier/types.js";
import { fetchOpenIssues, type FetchIssuesOptions } from "./github-issues.js";
import { HeuristicBacklogClient } from "./heuristic-client.js";
import { MAX_PRICE_XOF, normalizePrice } from "./price.js";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";
import { backlogAnswerJsonSchema, parseBacklogAnswer } from "./schema.js";
import type { BacklogIssue, BacklogResult, BacklogSuggestion } from "./types.js";

export interface SuggestOptions {
  client?: VerifierClient;
  /** Most issues sent to the model (recent first). Bounds time and cost on big backlogs. */
  maxIssues?: number;
  /** Issues per model call. */
  batchSize?: number;
  /** Model calls in flight at once (default: all batches together). */
  concurrency?: number;
  /** Whole-call deadline (ms): batches still running are dropped with a warning, the rest comes back. */
  deadlineMs?: number;
  /** Per-call timeout (ms). */
  timeoutMs?: number;
  /** Extra attempts per batch, for transient errors only. */
  retries?: number;
  backoffMs?: number;
}

export const DEFAULT_MAX_ISSUES = 60;
export const DEFAULT_BATCH_SIZE = 15;
export const DEFAULT_DEADLINE_MS = 120_000;

/** Backlog-specific tripwire on top of the verifier's: talking to the pricer about price, fit or confidence. */
const BACKLOG_INJECTION_PATTERNS: RegExp[] = [
  /\b(price_xof|issue_number)\b\s*[:=]/i,
  // `fits` / `confidence` only with a value: "Where X Fits: …" is a heading, "fits: true" is an order.
  /\b(fits|confidence)\b["']?\s*[:=]\s*["']?(true|false|yes|no|high|medium|low|élevée|haute)\b/i,
  /\b(set|mark|make|price|rate)\b[^\n]{0,40}\b(price_xof|fits|confidence)\b/i,
  /\b(ignorez|oubliez|ignore[rz]?)\b[^\n]{0,40}(consignes|instructions|règles|regles|précédent)/i,
  /\b(note|message)\s+(au|aux|to the)\s+(relecteur|reviewer|pricer|modèle|model)/i,
  /\b(vaut|worth|price it at|mettez|put)\b[^\n]{0,30}\d[\d\s.,]{3,}\s*(fcfa|xof|cfa)/i,
  /\bconfidence\s+(high|élevée)\b|\bhigh confidence\b/i,
  // Notes aimed at whoever estimates or selects it.
  /\b(pre-?approved|pré-?approuvée?|system note|note système|select it|cochez[- ]la|à cocher|estimateur|whoever estimates)\b/i,
];

/** Above this, a suggestion is never pre-selected: a human looks at big prices first. */
export const PRESELECT_MAX_XOF = 50_000;

export function looksLikeInjection(title: string, body: string): boolean {
  return detectInjection(title, body) || BACKLOG_INJECTION_PATTERNS.some((re) => re.test(`${title}\n${body}`));
}

/** Stable, unique across repos, URL-safe: "teranga-labs/bitnob-js" #21 → "sug-teranga-labs-bitnob-js-21". */
export const suggestionId = (repoFullName: string, issueNumber: number) =>
  `sug-${repoFullName.replace(/[^A-Za-z0-9-]/g, "-")}-${issueNumber}`;

/** Real client when ANTHROPIC_API_KEY is set (BACKLOG_MODEL, else VERIFIER_MODEL), otherwise the offline heuristic. */
export function createBacklogClient(env: NodeJS.ProcessEnv = process.env): VerifierClient {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return new HeuristicBacklogClient();
  const model = env.BACKLOG_MODEL?.trim() || env.VERIFIER_MODEL?.trim() || DEFAULT_VERIFIER_MODEL;
  return new AnthropicVerifierClient({ apiKey, model });
}

/**
 * "Price my backlog": which open issues make good bounties, with drafted criteria and a price
 * in FCFA. Suggestions only: nothing is created or funded here (the maintainer ticks and funds).
 *
 * Never trusts the model: unknown or duplicate issue numbers are dropped, criteria are capped
 * to 2-4, prices are clamped and rounded, an issue that looks like an injection is never
 * pre-selected. A failed batch is skipped with a warning instead of failing the whole call.
 */
export async function suggestBacklog(
  repoFullName: string,
  issues: BacklogIssue[],
  opts: SuggestOptions = {},
): Promise<BacklogResult> {
  const client = opts.client ?? createBacklogClient();
  const maxIssues = Math.max(0, opts.maxIssues ?? DEFAULT_MAX_ISSUES);
  const batchSize = Math.max(1, opts.batchSize ?? DEFAULT_BATCH_SIZE);
  const warnings: string[] = [];

  const considered = [...issues].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, maxIssues);
  const byNumber = new Map(considered.map((i) => [i.number, i]));
  const batches: BacklogIssue[][] = [];
  for (let i = 0; i < considered.length; i += batchSize) batches.push(considered.slice(i, i + batchSize));

  const suggestions: BacklogSuggestion[] = [];
  const seen = new Set<number>();
  // Aborted at the deadline: in-flight model calls are cancelled, no new batch or retry starts.
  const stop = new AbortController();
  const work = runLimited(batches, opts.concurrency ?? batches.length, stop.signal, async (batch, index) => {
    const label = `batch ${index + 1}/${batches.length}`;
    let raw: string;
    try {
      raw = await callWithRetry(client, buildUserPrompt(repoFullName, batch), opts, stop.signal);
    } catch (err) {
      warnings.push(`${label} failed: ${errorMessage(err)}`);
      return;
    }
    const answer = parseBacklogAnswer(raw);
    if (!answer) {
      warnings.push(`${label}: answer was not JSON with an "issues" list (cut off or invalid), skipped`);
      return;
    }
    if (answer.invalid) warnings.push(`${label}: ${answer.invalid} invalid entr${answer.invalid === 1 ? "y" : "ies"} dropped`);
    const inBatch = new Set(batch.map((i) => i.number));
    const answered = new Set(answer.entries.map((a) => a.issue_number));
    const missing = batch.filter((i) => !answered.has(i.number)).map((i) => i.number).sort((x, y) => x - y).map((n) => `#${n}`);
    if (missing.length) warnings.push(`${label}: no answer for ${missing.join(", ")}`);
    for (const a of answer.entries) {
      const issue = byNumber.get(a.issue_number);
      if (!issue || !inBatch.has(a.issue_number) || seen.has(a.issue_number)) continue;
      seen.add(a.issue_number);
      if (!a.fits) continue;
      const criteria = a.criteria.map((c) => c.trim()).filter(Boolean).slice(0, 4);
      if (criteria.length < 2) continue; // no testable criteria = no bounty (docs/product.md, flow 2)
      const injection = looksLikeInjection(issue.title, issue.body);
      if (injection) warnings.push(`#${issue.number}: possible prompt injection in the issue, not pre-selected`);
      const confidence = injection ? "low" : a.confidence;
      // 0 or a negative price with fits: true is a contradiction: not a bounty.
      if (!(a.price_xof > 0)) {
        warnings.push(`#${issue.number}: price ${a.price_xof} with fits: true, skipped`);
        continue;
      }
      const priceXof = normalizePrice(a.price_xof);
      suggestions.push({
        id: suggestionId(repoFullName, issue.number),
        repoFullName,
        issueNumber: issue.number,
        issueTitle: issue.title,
        criteria: criteria.map((text) => ({ text })),
        priceXof,
        reason: a.reason.trim(),
        confidence,
        // A big price is worth a human look before it's ticked.
        selected: confidence === "high" && priceXof <= PRESELECT_MAX_XOF && priceXof < MAX_PRICE_XOF,
      });
    }
  });

  const deadlineMs = opts.deadlineMs ?? DEFAULT_DEADLINE_MS;
  let deadline: NodeJS.Timeout | undefined;
  const timedOut = await Promise.race([
    work.then(() => false),
    new Promise<boolean>((resolve) => {
      deadline = setTimeout(() => resolve(true), deadlineMs);
    }),
  ]);
  clearTimeout(deadline);
  if (timedOut) {
    stop.abort();
    warnings.push(`stopped after ${Math.round(deadlineMs / 1000)} s: partial results`);
  }
  // Freeze what we return: batches still running after the deadline can't change it.
  const done = [...suggestions];

  const rank = { high: 0, medium: 1, low: 2 } as const;
  done.sort((a, b) => rank[a.confidence] - rank[b.confidence] || a.issueNumber - b.issueNumber);
  return {
    repoFullName,
    suggestions: done,
    issuesRead: issues.length,
    issuesConsidered: considered.length,
    issuesSkipped: issues.length - considered.length,
    model: client.name,
    isFake: client.isFake,
    warnings: [...warnings],
  };
}

/** Fetch the repo's open issues from GitHub, then `suggestBacklog`. */
export async function priceRepoBacklog(
  repoFullName: string,
  opts: SuggestOptions & { github?: FetchIssuesOptions } = {},
): Promise<BacklogResult> {
  // The API returns most recently updated first, so reading `maxIssues` is enough (saves rate limit).
  const issues = await fetchOpenIssues(repoFullName, { limit: opts.maxIssues ?? DEFAULT_MAX_ISSUES, ...opts.github });
  return suggestBacklog(repoFullName, issues, opts);
}

async function callWithRetry(client: VerifierClient, user: string, opts: SuggestOptions, stop: AbortSignal): Promise<string> {
  const retries = opts.retries ?? 1;
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const backoff = opts.backoffMs ?? 1_000;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, backoff * 2 ** (attempt - 1)));
    if (stop.aborted) throw new Error("stopped at the deadline");
    const ctrl = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    let onStop = () => {};
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ctrl.abort();
        reject(new Error(`timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      // The deadline cancels the call too, even with a client that ignores the signal.
      onStop = () => {
        ctrl.abort();
        reject(new Error("stopped at the deadline"));
      };
    });
    stop.addEventListener("abort", onStop, { once: true });
    try {
      return await Promise.race([
        client.complete({ system: SYSTEM_PROMPT, user, schema: backlogAnswerJsonSchema, signal: ctrl.signal }),
        timeout,
      ]);
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err)) break;
    } finally {
      clearTimeout(timer);
      stop.removeEventListener("abort", onStop);
    }
    if (stop.aborted) break;
  }
  throw lastErr;
}

async function runLimited<T>(
  items: T[],
  limit: number,
  stop: AbortSignal,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (next < items.length && !stop.aborted) {
      const i = next++;
      await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
}

function errorMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 200);
}

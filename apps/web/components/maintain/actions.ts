"use server";
// U4: Pay / Hold and "Price my backlog" from /app/maintain. The server runs Pay / Hold through the
// same path as `/pay` / `/hold` on GitHub (POST /api/maintain/bounties/:id/pay|hold).
import dashboard from "../../../../fixtures/dashboard.json";
import type { BacklogSuggestion } from "../../../../fixtures/types";
import { apiBaseUrl, identityHeaders } from "../../lib/api";
import { sessionLogin } from "../../lib/session-login";
import type { Decision, DecisionResult } from "./shape";

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const REPO_RE = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

async function post(path: string, body: unknown, timeoutMs: number): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const base = apiBaseUrl()!;
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...identityHeaders(await sessionLogin()) },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

export async function decideBounty(bountyId: string, decision: Decision, note?: string): Promise<DecisionResult> {
  if (!ID_RE.test(bountyId) || (decision !== "pay" && decision !== "hold")) return { ok: false, error: "invalid" };
  // Fixtures mode: nothing to persist; the page shows the outcome the server would give.
  if (!apiBaseUrl()) return { ok: true, status: decision === "pay" ? "verified" : "on_hold" };
  try {
    const { status, json } = await post(`/api/maintain/bounties/${encodeURIComponent(bountyId)}/${decision}`, decision === "hold" ? { note: note ?? null } : {}, 15_000);
    if (status === 200 && typeof json?.status === "string") return { ok: true, status: json.status as Extract<DecisionResult, { ok: true }>["status"] };
    return { ok: false, error: typeof json?.error === "string" ? json.error : "server_error" };
  } catch {
    return { ok: false, error: "server_unreachable" };
  }
}

export type SuggestResult = { ok: true; repo: string; suggestions: BacklogSuggestion[] } | { ok: false; error: string };

/** A3: POST /api/backlog/suggest {repo}. Fixtures: the dashboard's sample backlog. */
export async function suggestBacklog(repo: string): Promise<SuggestResult> {
  if (!REPO_RE.test(repo)) return { ok: false, error: "invalid_repo" };
  if (!apiBaseUrl()) {
    const all = dashboard.backlog as unknown as BacklogSuggestion[];
    const own = all.filter((s) => s.repoFullName.toLowerCase() === repo.toLowerCase());
    return { ok: true, repo, suggestions: own.length ? own : all };
  }
  try {
    const { status, json } = await post("/api/backlog/suggest", { repo }, 60_000);
    if (status === 200 && Array.isArray(json?.suggestions)) return { ok: true, repo, suggestions: json.suggestions as BacklogSuggestion[] };
    return { ok: false, error: typeof json?.error === "string" ? json.error : "server_error" };
  } catch {
    return { ok: false, error: "server_unreachable" };
  }
}

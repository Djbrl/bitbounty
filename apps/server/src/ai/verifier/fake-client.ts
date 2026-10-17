import type { ModelAnswer } from "./schema.js";
import type { VerifierClient, VerifierRequest } from "./types.js";

type Responder = (req: VerifierRequest, call: number) => string | Promise<string>;

/** Scripted fake for tests: returns what you give it (string, object, or a function). */
export class FakeVerifierClient implements VerifierClient {
  readonly name = "fake:scripted";
  readonly isFake = true;
  calls: VerifierRequest[] = [];
  private readonly responder: Responder;

  constructor(response: string | ModelAnswer | Responder) {
    this.responder =
      typeof response === "function"
        ? response
        : () => (typeof response === "string" ? response : JSON.stringify(response));
  }

  async complete(req: VerifierRequest): Promise<string> {
    this.calls.push(req);
    return this.responder(req, this.calls.length);
  }
}

/**
 * Offline demo fake: no key, deterministic, crude. A criterion counts as met when at
 * least half of its significant words appear in the added lines of the diff.
 */
export class HeuristicVerifierClient implements VerifierClient {
  readonly name = "fake:heuristic";
  readonly isFake = true;

  async complete(req: VerifierRequest): Promise<string> {
    const criteria = extractBlock(req.user, "criteria")
      .split("\n")
      .map((l) => l.replace(/^\d+\.\s*/, "").trim())
      .filter(Boolean);
    const added = extractBlock(req.user, "diff")
      .split("\n")
      .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
      .join("\n")
      .toLowerCase();
    const ciFailing = /status: failure/.test(req.user);
    const results = criteria.map((text) => {
      const words = text.toLowerCase().match(/[a-z0-9_]{4,}/g) ?? [];
      const hits = words.filter((w) => added.includes(w));
      const met = words.length > 0 && hits.length / words.length >= 0.5;
      return { text, met, evidence: met ? `added lines mention: ${hits.join(", ")}` : "no matching change found" };
    });
    const allMet = results.length > 0 && results.every((r) => r.met);
    const noneMet = results.every((r) => !r.met);
    const verdict = allMet && !ciFailing ? "pass" : noneMet ? "fail" : "unsure";
    const answer: ModelAnswer = {
      criteria: results,
      verdict,
      summary: `Offline heuristic check: ${results.filter((r) => r.met).length}/${results.length} criteria matched.`,
      risk_flags: ciFailing ? ["CI failing"] : [],
    };
    return JSON.stringify(answer);
  }
}

function extractBlock(user: string, name: string): string {
  const m = new RegExp(`<untrusted-${name} id="([0-9a-f]+)">\\n([\\s\\S]*?)\\n</untrusted-${name} id="\\1">`).exec(user);
  return m?.[2] ?? "";
}

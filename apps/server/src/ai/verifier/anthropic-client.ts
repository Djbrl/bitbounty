import Anthropic from "@anthropic-ai/sdk";
import type { VerifierClient, VerifierRequest } from "./types.js";

export const DEFAULT_VERIFIER_MODEL = "claude-sonnet-5-5";

export interface AnthropicVerifierOptions {
  apiKey: string;
  model?: string;
  /** Per-attempt HTTP timeout in ms. `verify()` also enforces its own timeout. */
  timeoutMs?: number;
}

/**
 * Real adapter: one Messages API call with structured outputs (JSON schema).
 * Retries are done by `verify()` (SDK retries off) so the total time stays bounded.
 */
export class AnthropicVerifierClient implements VerifierClient {
  readonly name: string;
  readonly isFake = false;
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(opts: AnthropicVerifierOptions) {
    this.model = opts.model ?? DEFAULT_VERIFIER_MODEL;
    this.name = `anthropic:${this.model}`;
    this.client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 0, timeout: opts.timeoutMs ?? 90_000 });
  }

  async complete(req: VerifierRequest): Promise<string> {
    const res = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: 8000,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
        output_config: { effort: "medium", format: { type: "json_schema", schema: req.schema } },
      },
      { signal: req.signal },
    );
    // Refusal or max_tokens: return what we have; verify() turns anything invalid into `unsure`.
    if (res.stop_reason === "refusal") return "";
    return res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  }
}

/** Errors worth another attempt: network, timeouts, 408/409/429/5xx. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof Anthropic.APIConnectionError) return true; // includes timeouts
  if (err instanceof Anthropic.APIError) {
    const s = err.status ?? 0;
    return s === 408 || s === 409 || s === 429 || s >= 500;
  }
  return true; // our own timeout / unknown transient errors
}

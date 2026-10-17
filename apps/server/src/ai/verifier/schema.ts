import { z } from "zod";

/**
 * Wire format the model must answer with (snake_case `risk_flags`, as in docs/plan.md §5).
 * `.strict()` rejects unknown keys: anything off-schema becomes `unsure`.
 */
export const modelAnswerSchema = z
  .object({
    criteria: z.array(
      z
        .object({
          text: z.string(),
          met: z.boolean(),
          evidence: z.string().max(2000),
        })
        .strict(),
    ),
    verdict: z.enum(["pass", "fail", "unsure"]),
    summary: z.string().max(2000),
    risk_flags: z.array(z.string().max(300)).max(20),
  })
  .strict();

export type ModelAnswer = z.infer<typeof modelAnswerSchema>;

/** Same shape as JSON schema, sent as `output_config.format` (structured outputs). */
export const modelAnswerJsonSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["criteria", "verdict", "summary", "risk_flags"],
  properties: {
    criteria: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "met", "evidence"],
        properties: {
          text: { type: "string" },
          met: { type: "boolean" },
          evidence: { type: "string" },
        },
      },
    },
    verdict: { type: "string", enum: ["pass", "fail", "unsure"] },
    summary: { type: "string" },
    risk_flags: { type: "array", items: { type: "string" } },
  },
};

/** Parse raw model text. Returns null on invalid JSON or schema mismatch. */
export function parseModelAnswer(raw: string): ModelAnswer | null {
  let json: unknown;
  try {
    json = JSON.parse(stripFences(raw.trim()));
  } catch {
    return null;
  }
  const res = modelAnswerSchema.safeParse(json);
  return res.success ? res.data : null;
}

/** Tolerate a ```json fence around an otherwise valid object; nothing more. */
function stripFences(s: string): string {
  const m = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(s);
  return m?.[1] ?? s;
}

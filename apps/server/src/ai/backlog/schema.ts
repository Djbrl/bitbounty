import { z } from "zod";

/** One entry of the model's answer. Long strings are trimmed, not rejected (see `parseBacklogAnswer`). */
export const backlogEntrySchema = z
  .object({
    issue_number: z.number().int(),
    fits: z.boolean(),
    reason: z.string(),
    criteria: z.array(z.string()),
    price_xof: z.number(),
    confidence: z.enum(["high", "medium", "low"]),
  })
  .strict();

export type BacklogEntry = z.infer<typeof backlogEntrySchema>;
export interface BacklogAnswer {
  issues: BacklogEntry[];
}

export const backlogAnswerJsonSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["issues"],
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["issue_number", "fits", "reason", "criteria", "price_xof", "confidence"],
        properties: {
          issue_number: { type: "integer" },
          fits: { type: "boolean" },
          reason: { type: "string" },
          criteria: { type: "array", items: { type: "string" } },
          price_xof: { type: "integer" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
    },
  },
};

export const MAX_REASON_CHARS = 600;
export const MAX_CRITERION_CHARS = 300;

export interface ParsedBacklogAnswer {
  entries: BacklogEntry[];
  /** Entries that didn't match the schema and were dropped one by one. */
  invalid: number;
}

/**
 * Parse raw model text. Null when it isn't JSON with an `issues` array (e.g. an answer cut off
 * by max_tokens). Each entry is validated on its own, so one bad entry doesn't drop the batch.
 */
export function parseBacklogAnswer(raw: string): ParsedBacklogAnswer | null {
  let json: unknown;
  try {
    const s = raw.trim();
    const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(s);
    json = JSON.parse(fenced?.[1] ?? s);
  } catch {
    return null;
  }
  const issues = (json as { issues?: unknown } | null)?.issues;
  if (!Array.isArray(issues)) return null;
  const entries: BacklogEntry[] = [];
  let invalid = 0;
  for (const item of issues) {
    const res = backlogEntrySchema.safeParse(item);
    if (!res.success) {
      invalid++;
      continue;
    }
    entries.push({
      ...res.data,
      reason: res.data.reason.slice(0, MAX_REASON_CHARS),
      criteria: res.data.criteria.map((c) => c.slice(0, MAX_CRITERION_CHARS)),
    });
  }
  return { entries, invalid };
}

import type { VerifierClient, VerifierRequest } from "../verifier/types.js";
import type { BacklogAnswer } from "./schema.js";

const ISSUE_RE =
  /Issue #(\d+) \(labels: ([^;]*);[^\n]*\n<untrusted-issue id="([0-9a-f]+)">\nTitle: ([^\n]*)\n\n([\s\S]*?)\n<\/untrusted-issue id="\3">/g;

/**
 * Offline fake (no API key): deterministic and crude, so the demo and tests work without
 * a model. An issue fits when it has a real description and isn't a question; criteria come
 * from its "- [ ]" checklist when there is one; the price grows with the description.
 */
export class HeuristicBacklogClient implements VerifierClient {
  readonly name = "fake:heuristic-backlog";
  readonly isFake = true;

  async complete(req: VerifierRequest): Promise<string> {
    const issues: BacklogAnswer["issues"] = [];
    for (const m of req.user.matchAll(ISSUE_RE)) {
      const num = Number(m[1]);
      const labels = m[2] ?? "";
      const title = m[4] ?? "";
      const body = m[5] ?? "";
      const text = `${title}\n${body}`;
      const checklist = [...body.matchAll(/^\s*[-*] \[ \] (.+)$/gm)].map((c) => c[1]!.trim()).slice(0, 4);
      const question = /\?\s*$/.test(title.trim()) || /\b(question|discussion)\b/i.test(labels);
      // Roadmaps and tracking issues list many tasks: not one bounty.
      const tracking = /\b(roadmap|tracking|epic|meta|features? list|v\d+(\.\d+)* (plan|features))\b/i.test(`${title} ${labels}`);
      const fits = !question && !tracking && body !== "(no description)" && body.trim().length >= 40;
      const french = (text.match(/\b(le|la|les|des|une|est|pour|avec|dans)\b/gi)?.length ?? 0) >= 3;
      const short = title.slice(0, 80);
      const criteria = !fits
        ? []
        : checklist.length >= 2
          ? checklist
          : french
            ? [`Le changement décrit dans « ${short} » est implémenté`, "Il est couvert par un test ou une vérification manuelle documentée"]
            : [`The change described in "${short}" is implemented`, "It is covered by a test or a documented manual check"];
      const docs = /\b(docs?|documentation|readme|typo|translation|traduction)\b/i.test(text);
      const price = !fits ? 0 : docs ? 5_000 : Math.min(40_000, 7_500 + Math.floor(body.length / 200) * 2_500);
      issues.push({
        issue_number: num,
        fits,
        reason: fits
          ? checklist.length >= 2
            ? "Has a description and a checklist that can be checked in a PR (offline heuristic)."
            : "Has a concrete description (offline heuristic)."
          : question
            ? "Looks like a question or a discussion, not a task (offline heuristic)."
            : tracking
              ? "A roadmap or tracking issue, not one task (offline heuristic)."
              : "Too little description to write testable criteria (offline heuristic).",
        criteria,
        price_xof: price,
        confidence: fits && checklist.length >= 2 ? "high" : fits ? "medium" : "low",
      });
    }
    return JSON.stringify({ issues } satisfies BacklogAnswer);
  }
}

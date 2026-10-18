// U3: client-safe helpers for bounty cards and the /explore filters (no fixtures, no server imports).
import type { BountySummary } from "../../../../fixtures/types";

export type { BountySummary };

// ---------------------------------------------------------------------------
// Languages of a bounty. The API carries no repo language yet, so: an explicit label
// (`typescript`, `lang:go`, `rust`…) wins, else the repo name's suffix (`bitnob-js` → JavaScript).

const ALIASES: Record<string, string> = {
  js: "JavaScript",
  javascript: "JavaScript",
  node: "JavaScript",
  ts: "TypeScript",
  typescript: "TypeScript",
  py: "Python",
  python: "Python",
  go: "Go",
  golang: "Go",
  rs: "Rust",
  rust: "Rust",
  rb: "Ruby",
  ruby: "Ruby",
  rails: "Ruby",
  php: "PHP",
  java: "Java",
  kt: "Kotlin",
  kotlin: "Kotlin",
  swift: "Swift",
  dart: "Dart",
  flutter: "Dart",
  c: "C",
  cpp: "C++",
  cs: "C#",
  csharp: "C#",
  sol: "Solidity",
  solidity: "Solidity",
  md: "Markdown",
  markdown: "Markdown",
  docs: "Markdown",
};

/** Languages that count as the same stack when matching (a TypeScript dev takes a JS issue). */
const FAMILY: Record<string, string> = { TypeScript: "JavaScript", JavaScript: "JavaScript" };
export const languageFamily = (lang: string) => FAMILY[lang] ?? lang;

export function canonicalLanguage(raw: string): string | null {
  const key = raw.trim().toLowerCase().replace(/^lang(uage)?[:/-]/, "");
  return ALIASES[key] ?? null;
}

export function bountyLanguages(b: Pick<BountySummary, "labels" | "repoFullName">): string[] {
  const fromLabels = b.labels.map(canonicalLanguage).filter((l): l is string => l !== null);
  if (fromLabels.length) return [...new Set(fromLabels)];
  const name = b.repoFullName.split("/")[1] ?? "";
  const suffix = name.split(/[-_.]/).pop() ?? "";
  const fromRepo = name.includes("-") || name.includes("_") || name.includes(".") ? canonicalLanguage(suffix) : null;
  return fromRepo ? [fromRepo] : [];
}

// ---------------------------------------------------------------------------
// Explore filters (language, amount, repo, text).

export type AmountBucket = "all" | "lt10" | "10to20" | "gte20";
export const AMOUNT_BUCKETS: readonly AmountBucket[] = ["all", "lt10", "10to20", "gte20"];

export function inBucket(xof: number, bucket: AmountBucket): boolean {
  if (bucket === "lt10") return xof < 10_000;
  if (bucket === "10to20") return xof >= 10_000 && xof < 20_000;
  if (bucket === "gte20") return xof >= 20_000;
  return true;
}

export interface ExploreFilter {
  language: string;
  amount: AmountBucket;
  repo: string;
  q: string;
}

export const NO_FILTER: ExploreFilter = { language: "all", amount: "all", repo: "all", q: "" };

export function exploreOptions(rows: BountySummary[]): { languages: string[]; repos: string[] } {
  const languages = [...new Set(rows.flatMap(bountyLanguages))].sort((a, b) => a.localeCompare(b));
  const repos = [...new Set(rows.map((b) => b.repoFullName))].sort((a, b) => a.localeCompare(b));
  return { languages, repos };
}

export function applyExplore(rows: BountySummary[], f: ExploreFilter): BountySummary[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter(
    (b) =>
      (f.language === "all" || bountyLanguages(b).includes(f.language)) &&
      inBucket(b.amountXof, f.amount) &&
      (f.repo === "all" || b.repoFullName === f.repo) &&
      (!q || `${b.issueTitle} ${b.repoFullName} ${b.labels.join(" ")}`.toLowerCase().includes(q)),
  );
}

/** "il y a 3 h" / "3 h ago" (coarse, for card footers). */
export function timeAgo(iso: string, now: number, lang: "fr" | "en"): string {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  const v = min < 60 ? `${min} min` : min < 1440 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} ${lang === "fr" ? "j" : "d"}`;
  return lang === "fr" ? `il y a ${v}` : `${v} ago`;
}

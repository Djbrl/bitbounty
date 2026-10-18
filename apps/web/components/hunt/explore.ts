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

// ---------------------------------------------------------------------------
// Explore "mission select": one entry per BitBounty-enabled repo with open bounties.

export interface ProjectSummary {
  repoFullName: string;
  owner: string;
  name: string;
  /** Open (funded, not paid yet) bounties on this repo. */
  openCount: number;
  /** Of those, still free to claim. */
  claimableCount: number;
  totalXof: number;
  languages: string[];
  /** Newest open issue title, as a hint of what the work looks like. */
  latestTitle: string;
}

/** Group open bounties by repo; most claimable money first. */
export function projectSummaries(rows: BountySummary[]): ProjectSummary[] {
  const by = new Map<string, BountySummary[]>();
  for (const b of rows) by.set(b.repoFullName, [...(by.get(b.repoFullName) ?? []), b]);
  return [...by.entries()]
    .map(([repoFullName, list]) => {
      const [owner = "", name = repoFullName] = repoFullName.split("/");
      const newest = [...list].sort((a, b) => (b.createdAt < a.createdAt ? -1 : b.createdAt > a.createdAt ? 1 : 0))[0]!;
      return {
        repoFullName,
        owner,
        name,
        openCount: list.length,
        claimableCount: list.filter((b) => b.status === "funded").length,
        totalXof: list.reduce((s, b) => s + b.amountXof, 0),
        languages: [...new Set(list.flatMap(bountyLanguages))].sort((a, b) => a.localeCompare(b)),
        latestTitle: newest.issueTitle,
      };
    })
    .sort((a, b) => b.claimableCount - a.claimableCount || b.totalXof - a.totalXof || a.repoFullName.localeCompare(b.repoFullName));
}

/** "il y a 3 h" / "3 h ago" (coarse, for card footers). */
export function timeAgo(iso: string, now: number, lang: "fr" | "en"): string {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  const v = min < 60 ? `${min} min` : min < 1440 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} ${lang === "fr" ? "j" : "d"}`;
  return lang === "fr" ? `il y a ${v}` : `${v} ago`;
}

// ---------------------------------------------------------------------------
// /explore and /app/explore search params.

export type ExploreParams = { q?: string | string[]; repo?: string | string[] };

const firstParam = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? "").slice(0, 100);

export function exploreQuery(params: ExploreParams): { q: string; repo: string } {
  return { q: firstParam(params.q).trim(), repo: firstParam(params.repo).trim() };
}

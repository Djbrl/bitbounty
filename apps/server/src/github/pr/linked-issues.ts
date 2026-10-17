/**
 * Finds the issues a PR says it closes ("Fixes #12"), the way GitHub does:
 * one closing keyword per reference, so "Fixes #1, fixes #2" links both while
 * "Fixes #1, #2" links only #1 (GitHub would only close #1 on merge too).
 *
 * Pure: no I/O. Text inside code blocks, inline code and HTML comments is ignored,
 * so a PR template saying `<!-- Fixes #123 -->` links nothing.
 */

export interface IssueRef {
  /** `owner/name` of the repository the issue lives in. */
  repo: string;
  number: number;
}

export interface LinkedIssues {
  /** Issue numbers in the PR's own repository, deduped, in order of appearance. */
  issues: number[];
  /** References to issues in other repositories. Never linked to a bounty; reported so callers can log them. */
  crossRepo: IssueRef[];
}

const KEYWORDS = "close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved";
const NAME = "[A-Za-z0-9_.-]+";
// keyword, then ":" and/or whitespace, then one of: full issue URL, owner/repo#n, #n.
const LINK_RE = new RegExp(
  `(?<![\\w-])(?:${KEYWORDS})(?:\\s*:\\s*|\\s+)` +
    `(?:https?://(?:www\\.)?github\\.com/(${NAME})/(${NAME})/issues/(\\d+)(?![\\w/-])` +
    `|(${NAME})/(${NAME})#(\\d+)(?!\\w)` +
    `|#(\\d+)(?!\\w))`,
  "gi",
);

/** GitHub issue numbers are positive int32s; anything else is noise. */
const MAX_ISSUE = 2_147_483_647;

function stripNonProse(text: string): string {
  return text
    .replace(/<!--[\s\S]*?(?:-->|$)/g, " ")
    .replace(/(^|\n)[ \t]*(```|~~~)[\s\S]*?(?:\n[ \t]*\2[^\n]*|$)/g, "\n")
    .replace(/`[^`\n]*`/g, " ");
}

export function linkedIssues(
  prBody: string | null | undefined,
  prTitle: string | null | undefined,
  repo: string,
): LinkedIssues {
  const text = stripNonProse(`${prTitle ?? ""}\n${prBody ?? ""}`);
  const own = repo.toLowerCase();
  const issues: number[] = [];
  const crossRepo: IssueRef[] = [];
  const seenCross = new Set<string>();

  for (const m of text.matchAll(LINK_RE)) {
    const owner = m[1] ?? m[4];
    const name = m[2] ?? m[5];
    const num = Number(m[3] ?? m[6] ?? m[7]);
    if (!Number.isSafeInteger(num) || num < 1 || num > MAX_ISSUE) continue;

    const target = owner && name ? `${owner}/${name}` : repo;
    if (target.toLowerCase() === own) {
      if (!issues.includes(num)) issues.push(num);
    } else {
      const key = `${target.toLowerCase()}#${num}`;
      if (!seenCross.has(key)) {
        seenCross.add(key);
        crossRepo.push({ repo: target, number: num });
      }
    }
  }
  return { issues, crossRepo };
}

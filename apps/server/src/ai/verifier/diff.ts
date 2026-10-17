/** ~60k tokens at ~3.5 chars/token (docs/plan.md §5: cap the diff). */
export const DEFAULT_MAX_DIFF_CHARS = 200_000;

export interface DiffFile {
  path: string;
  text: string;
  isTest: boolean;
}

export interface TruncatedDiff {
  text: string;
  truncated: boolean;
  files: string[];
  omittedFiles: string[];
  originalChars: number;
}

const TEST_PATH =
  /(^|\/)(tests?|__tests__|spec|__fixtures__|fixtures)\/|\.(test|spec)\.[a-z0-9]+$|_test\.[a-z0-9]+$|(^|\/)test_[^/]+$/i;

export function isTestPath(path: string): boolean {
  return TEST_PATH.test(path);
}

/** Split a unified diff into per-file chunks (on `diff --git`). */
export function splitDiff(diff: string): DiffFile[] {
  const chunks = diff.split(/^(?=diff --git )/m).filter((c) => c.trim() !== "");
  return chunks.map((text) => {
    const header = /^diff --git a\/(\S+) b\/(\S+)/.exec(text);
    const plus = /^\+\+\+ (?:b\/)?(\S+)/m.exec(text);
    const path = header?.[2] ?? (plus?.[1] && plus[1] !== "/dev/null" ? plus[1] : "(unknown)");
    return { path, text, isTest: isTestPath(path) };
  });
}

/**
 * Keep the diff under `maxChars`: non-test files first, then tests (docs/plan.md §5).
 * Whole files are kept while they fit; the first one that doesn't is cut, the rest
 * are listed as omitted so the model knows it is not seeing everything.
 */
export function truncateDiff(diff: string, maxChars = DEFAULT_MAX_DIFF_CHARS): TruncatedDiff {
  const files = splitDiff(diff);
  const originalChars = diff.length;
  const allPaths = files.map((f) => f.path);
  if (originalChars <= maxChars) {
    return { text: diff, truncated: false, files: allPaths, omittedFiles: [], originalChars };
  }
  const ordered = [...files.filter((f) => !f.isTest), ...files.filter((f) => f.isTest)];
  const parts: string[] = [];
  const omitted: string[] = [];
  let used = 0;
  for (const f of ordered) {
    const room = maxChars - used;
    if (f.text.length <= room) {
      parts.push(f.text);
      used += f.text.length;
    } else if (room > 2_000) {
      parts.push(f.text.slice(0, room) + `\n[... ${f.path} cut: ${f.text.length - room} more chars ...]\n`);
      used = maxChars;
    } else {
      omitted.push(f.path);
    }
  }
  return { text: parts.join(""), truncated: true, files: allPaths, omittedFiles: omitted, originalChars };
}

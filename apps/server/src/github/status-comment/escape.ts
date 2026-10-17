/**
 * Escaping for user-provided text (issue titles, criteria, logins, reasons) that
 * ends up inside the bot's markdown comment. Pure, no dependencies.
 */

/** Zero-width space: breaks `@user` mentions and `-->` without changing what people see. */
const ZWSP = "​";

/** Markdown punctuation GitHub (CommonMark + GFM) treats specially. All are valid backslash escapes. */
const MD_SPECIAL = /[\\`*_{}[\]()#+\-.!|~$:]/g;

/** A real GitHub login: alphanumerics and single inner hyphens, at most 39 chars, optional `[bot]`. */
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}(?:\[bot\])?$/;

/** Cuts `text` to at most `max` code points, ending with `…` when cut. */
export function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return chars.slice(0, Math.max(0, max - 1)).join("").trimEnd() + "…";
}

/**
 * Makes untrusted text safe to drop inline into markdown: one line, control chars
 * removed, truncated, HTML neutralised, markdown punctuation escaped, mentions broken.
 * The output renders as the literal input text on GitHub.
 */
export function escapeInline(text: string, max = 200): string {
  const oneLine = String(text)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return truncate(oneLine, max)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(MD_SPECIAL, (c) => `\\${c}`)
    .replace(/@/g, `@${ZWSP}`);
}

export function isGithubLogin(login: string): boolean {
  return LOGIN_RE.test(login);
}

/** `@login` (a real mention) for a valid login; otherwise the escaped text, which pings nobody. */
export function mention(login: string): string {
  return isGithubLogin(login) ? `@${login}` : escapeInline(login, 40);
}

/** Encodes a path segment so it can't close a markdown link `(...)`. */
export function encodeSegment(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** A value safe inside an HTML comment: no `--`, no `>`, only `[A-Za-z0-9_.%-]`. */
export function markerSafe(value: string): string {
  return encodeSegment(value)
    .replace(/[^A-Za-z0-9_.%-]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/--/g, "-%2D");
}

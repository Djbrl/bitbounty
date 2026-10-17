import { describe, expect, it } from "vitest";
import { linkedIssues } from "./linked-issues.js";

const REPO = "bitbounty-demo/sandbox";
const issues = (body: string, title = "") => linkedIssues(body, title, REPO).issues;

describe("linkedIssues", () => {
  it.each([
    "Fixes #12",
    "fixes #12",
    "FIXES #12",
    "Fix #12",
    "fixed #12",
    "Closes #12",
    "close #12",
    "closed #12",
    "Resolves #12",
    "resolve #12",
    "RESOLVED #12",
    "Fixes: #12",
    "Fixes:#12",
    "fixes\t#12",
    "Some text.\nFixes #12.",
    "(fixes #12)",
    "- [x] Closes #12",
  ])("links %j", (body) => {
    expect(issues(body)).toEqual([12]);
  });

  it("reads the title too", () => {
    expect(linkedIssues(null, "Fix #7: crash on start", REPO).issues).toEqual([7]);
  });

  it("handles full issue URLs to the same repo, any case", () => {
    expect(issues("Fixes https://github.com/bitbounty-demo/sandbox/issues/12")).toEqual([12]);
    expect(issues("closes https://github.com/Bitbounty-Demo/Sandbox/issues/13#issuecomment-1")).toEqual([13]);
    expect(issues("Fixes http://www.github.com/bitbounty-demo/sandbox/issues/14")).toEqual([14]);
  });

  it("treats owner/repo#n of the same repo as local", () => {
    expect(issues("Fixes bitbounty-demo/sandbox#12")).toEqual([12]);
    expect(issues("Fixes BITBOUNTY-DEMO/SANDBOX#12")).toEqual([12]);
  });

  it("flags cross-repo references instead of linking them", () => {
    const r = linkedIssues(
      "Fixes other/repo#3, fixes https://github.com/other/thing/issues/4, fixes #5, fixes other/repo#3",
      "",
      REPO,
    );
    expect(r.issues).toEqual([5]);
    expect(r.crossRepo).toEqual([
      { repo: "other/repo", number: 3 },
      { repo: "other/thing", number: 4 },
    ]);
  });

  it("links several issues, deduped, in order", () => {
    expect(issues("Fixes #3, closes #1 and resolves #2. Also fixes #3 again.")).toEqual([3, 1, 2]);
    expect(issues("Fixes #3", "Closes #4")).toEqual([4, 3]);
  });

  it("needs one keyword per issue, like GitHub", () => {
    expect(issues("Fixes #1, #2")).toEqual([1]);
  });

  it.each([
    ["no keyword", "See #12"],
    ["keyword inside a word", "prefixes #12, unfixed #13, re-fixes #14"],
    ["no number", "Fixes #"],
    ["not a number", "Fixes #abc"],
    ["number glued to letters", "Fixes #12abc"],
    ["zero", "Fixes #0"],
    ["too large", "Fixes #99999999999"],
    ["pull URL, not an issue", "Fixes https://github.com/bitbounty-demo/sandbox/pull/12"],
    ["URL to a sub-path", "Fixes https://github.com/bitbounty-demo/sandbox/issues/12/foo"],
    ["inline code", "Use `fixes #12` in your PR"],
    ["fenced code", "Template:\n```\nFixes #12\n```\nDone."],
    ["HTML comment (PR template)", "<!-- Write Fixes #123 below -->\nThanks"],
    ["unterminated comment", "<!-- Fixes #12"],
    ["empty", ""],
  ])("ignores %s", (_, body) => {
    expect(issues(body)).toEqual([]);
  });

  it("still links prose after a code block", () => {
    expect(issues("```ts\nfixes #1\n```\nFixes #2")).toEqual([2]);
  });

  it("copes with null body and title", () => {
    expect(linkedIssues(null, null, REPO)).toEqual({ issues: [], crossRepo: [] });
  });
});

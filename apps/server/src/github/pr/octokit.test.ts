import { describe, expect, it, vi } from "vitest";
import { BITBOUNTY_CHECK_NAME, OctokitCiReader, OctokitNotifier, type RequestClient } from "./octokit.js";

const target = { repo: "bitbounty-demo/sandbox", sha: "abc", installationId: 1 };

function client(runs: Array<{ name: string; status: string; conclusion: string | null }>, status = { state: "pending", total_count: 0 }) {
  const request = vi.fn(async (route: string) => ({
    data: route.endsWith("check-runs") ? { check_runs: runs } : status,
  }));
  return { request } satisfies RequestClient;
}

describe("OctokitCiReader", () => {
  it("green when all checks pass (ours ignored) and no legacy statuses", async () => {
    const c = client([
      { name: "test", status: "completed", conclusion: "success" },
      { name: "lint", status: "completed", conclusion: "skipped" },
      { name: BITBOUNTY_CHECK_NAME, status: "completed", conclusion: "failure" },
    ]);
    expect(await new OctokitCiReader(async () => c).isGreen(target)).toBe(true);
    expect(c.request).toHaveBeenCalledWith("GET /repos/{owner}/{repo}/commits/{ref}/check-runs", {
      owner: "bitbounty-demo",
      repo: "sandbox",
      ref: "abc",
      per_page: 100,
    });
  });

  it.each([
    ["a failed check", [{ name: "test", status: "completed", conclusion: "failure" }], { state: "success", total_count: 1 }],
    ["a running check", [{ name: "test", status: "in_progress", conclusion: null }], { state: "success", total_count: 1 }],
    ["a failed legacy status", [], { state: "failure", total_count: 1 }],
  ])("not green with %s", async (_, runs, status) => {
    expect(await new OctokitCiReader(async () => client(runs, status)).isGreen(target)).toBe(false);
  });

  it("not green when the API fails or there's no installation", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await new OctokitCiReader(async () => Promise.reject(new Error("boom"))).isGreen(target)).toBe(false);
    expect(await new OctokitCiReader(async () => client([])).isGreen({ ...target, installationId: null })).toBe(false);
    warn.mockRestore();
  });
});

describe("OctokitNotifier", () => {
  it("posts an issue comment as the installation", async () => {
    const c = client([]);
    const clientFor = vi.fn(async () => c);
    await new OctokitNotifier(clientFor).comment({ repo: "a/b", issueNumber: 7, installationId: 9 }, "hi");
    expect(clientFor).toHaveBeenCalledWith(9);
    expect(c.request).toHaveBeenCalledWith("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
      owner: "a",
      repo: "b",
      issue_number: 7,
      body: "hi",
    });
  });
});

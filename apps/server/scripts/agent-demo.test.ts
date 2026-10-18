import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { DEMO_BOUNTY, DEMO_REPO, runAgentDemo, startLocalDemoServer, type LocalDemoServer } from "./agent-demo-scenario.js";

// The scripted fallback of docs/demo/agent-demo.md, over the real MCP stdio server (packages/mcp
// as a child process) against a local in-memory server. Nothing is paid, nothing leaves the machine.

const servers: LocalDemoServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});
const start = async () => {
  const s = await startLocalDemoServer();
  servers.push(s);
  return s;
};

describe("agent demo (scripted, over MCP stdio)", () => {
  it("posts the Wolof bounty unfunded, inside the budget, and is refused above it", async () => {
    const server = await start();
    const lines: string[] = [];
    const res = await runAgentDemo({ apiUrl: server.url, agentKey: server.key, log: (l) => lines.push(l) });

    expect(res.ok).toBe(true);
    expect(res.remainingBefore).toBe(20_000);
    expect(res.bounty).toMatchObject({ repo: DEMO_REPO, issue_number: 2, amount_xof: 15_000, status: "unfunded" });
    expect(res.bounty!.fund_url).toBe(`http://localhost:3000/pay/${res.bounty!.id}`);
    expect(res.remainingAfter).toBe(5_000);
    expect(res.refusal).toMatch(/HTTP 403.*over_budget[\s\S]*budget is used up/);

    // Server side: one bounty, unfunded (no money moved), with the issue's criteria; nothing on issue 6.
    const all = server.repo.all();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ status: "unfunded", funderKind: "agent", issueNumber: 2, amountXof: 15_000 });
    expect(all[0]!.criteria.map((c) => c.text)).toEqual(DEMO_BOUNTY.criteria);
    // What GitHub would show: the bot's status comment with the fund link, nothing on the refused issue.
    const [comment] = server.github.commentsOn(DEMO_REPO, 2);
    expect(comment?.body).toMatch(/15\s000\sFCFA/);
    expect(comment?.body).toContain(res.bounty!.fund_url);
    expect(server.github.commentsOn(DEMO_REPO, 6)).toHaveLength(0);
    expect(lines.join("\n")).toMatch(/1\. [\s\S]*6\. post_bounty[\s\S]*refused by the server/);
  }, 60_000);

  it("runs twice in a row from scratch (a fresh local server each time)", async () => {
    for (let i = 0; i < 2; i++) {
      const server = await start();
      const res = await runAgentDemo({ apiUrl: server.url, agentKey: server.key, log: () => undefined });
      expect(res.ok).toBe(true);
    }
  }, 90_000);

  it("refuses up front when the budget can't cover the bounty, and stops on the issue already funded", async () => {
    const server = await start();
    expect((await runAgentDemo({ apiUrl: server.url, agentKey: server.key, log: () => undefined })).ok).toBe(true);
    // Second run on the same server: 5 000 FCFA left, so the 15 000 FCFA post is refused by the budget.
    const lines: string[] = [];
    const again = await runAgentDemo({ apiUrl: server.url, agentKey: server.key, log: (l) => lines.push(l) });
    expect(again).toMatchObject({ ok: false, failedStep: "post_bounty", remainingBefore: 5_000 });
    expect(lines.join("\n")).toMatch(/over_budget/);
    // Within the budget but on the same issue: one bounty per issue.
    const sameIssue = await runAgentDemo({ apiUrl: server.url, agentKey: server.key, amountXof: 2_000, log: (l) => lines.push(l) });
    expect(sameIssue).toMatchObject({ ok: false, failedStep: "post_bounty" });
    expect(lines.join("\n")).toMatch(/issue_has_bounty[\s\S]*another issue with --issue/);
    expect(server.repo.all()).toHaveLength(1);
  }, 90_000);

  it("--cancel frees the budget", async () => {
    const server = await start();
    const res = await runAgentDemo({ apiUrl: server.url, agentKey: server.key, cancel: true, log: () => undefined });
    expect(res.ok).toBe(true);
    expect(server.repo.all()[0]?.status).toBe("cancelled");
  }, 60_000);

  it("a wrong key or an unreachable server stops at the first call with a clear message", async () => {
    const server = await start();
    const lines: string[] = [];
    const wrongKey = await runAgentDemo({ apiUrl: server.url, agentKey: "bb_wrong", log: (l) => lines.push(l) });
    expect(wrongKey).toMatchObject({ ok: false, failedStep: "get_budget" });
    expect(lines.join("\n")).toMatch(/unauthorized/);

    // A port nobody listens on (the network blip case): reported, nothing posted, no crash.
    const port = await new Promise<number>((resolve) => {
      const s = createServer().listen(0, "127.0.0.1", () => {
        const p = (s.address() as { port: number }).port;
        s.close(() => resolve(p));
      });
    });
    const down = await runAgentDemo({ apiUrl: `http://127.0.0.1:${port}`, agentKey: server.key, log: (l) => lines.push(l) });
    expect(down).toMatchObject({ ok: false, failedStep: "get_budget" });
    expect(lines.join("\n")).toMatch(/network_error[\s\S]*BITBOUNTY_API_URL/);
    expect(server.repo.all()).toHaveLength(0);
  }, 60_000);
});

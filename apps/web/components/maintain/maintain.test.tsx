import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import bounties from "../../../../fixtures/bounties.json";
import dashboard from "../../../../fixtures/dashboard.json";
import type { BountyDetail, Dashboard } from "../../../../fixtures/types";
import { ToastProvider } from "../ui";
import { decideBounty, suggestBacklog } from "./actions";
import { MaintainView } from "./maintain-view";
import { formatMinutes, mockHome, type MaintainHome } from "./shape";

const home = () => mockHome(bounties as unknown as BountyDetail[], dashboard as unknown as Dashboard, new Date("2026-10-18T10:00:00Z"));
const noopDecide = async () => ({ ok: true as const, status: "verified" as const });
const noopSuggest = async () => ({ ok: false as const, error: "x" });
const render = (data: MaintainHome, lang: "fr" | "en" = "fr") =>
  renderToStaticMarkup(
    <ToastProvider>
      <MaintainView data={data} lang={lang} decide={noopDecide} suggest={noopSuggest} />
    </ToastProvider>,
  );

describe("mockHome (fixtures mode)", () => {
  it("puts on-hold first, then PRs in, then verified, with Claude's per-criterion verdict", () => {
    const h = home();
    expect(h.queue.map((q) => [q.bountyId, q.status])).toEqual([
      ["b-109", "on_hold"],
      ["b-104", "submitted"],
      ["b-105", "verified"],
    ]);
    const onHold = h.queue[0]!;
    expect(onHold.canPay).toBe(true);
    expect(onHold.canHold).toBe(false);
    expect(h.queue[2]).toMatchObject({ canPay: false, canHold: true });
    expect(h.queue[1]!.criteria.length).toBeGreaterThan(0);
    expect(h.queue[1]!.criteria.every((c) => typeof c.met === "boolean")).toBe(true);
  });

  it("lists payouts with a public reason, never the raw error", () => {
    const h = home();
    const failed = h.payouts.find((p) => p.status === "failed")!;
    expect(failed.reason).toBe("wallet_unreachable");
    expect(JSON.stringify(h)).not.toContain("timed out after");
    expect(h.payouts.find((p) => p.status === "paid")?.receiptId).toBeTruthy();
    expect(h.summary.fundedSats).toBeGreaterThan(0);
    expect(h.summary.atStakeXof).toBeGreaterThan(0);
  });
});

describe("MaintainView", () => {
  it("renders the summary, the queue and the sidebar anchors in French by default", () => {
    const html = render(home());
    for (const id of ["review", "repos", "payouts", "backlog"]) expect(html).toContain(`id="${id}"`);
    expect(html).toContain("À relire");
    expect(html).toContain("Payé ce mois-ci");
    expect(html).toContain("Payer");
    expect(html).toContain("Bloquer");
    expect(html).toContain("https://github.com/apps/bitbounty-dakar");
    expect(html).toContain("Le portefeuille du développeur ne répond pas.");
    expect(html).not.toContain("walletofsatoshi");
    expect(html).toMatch(/href="\/r\/[^"]+"/);
  });

  it("speaks English with bb_lang=en", () => {
    const html = render(home(), "en");
    expect(html).toContain("Review queue");
    expect(html).toContain("Install on more repos");
    expect(html).toContain("Paid this month");
  });

  it("shows the empty state without repos or bounties", () => {
    const empty: MaintainHome = { ...home(), repos: [], queue: [], payouts: [], agents: [] };
    const html = render(empty);
    expect(html).toContain("Pas encore de dépôt");
    expect(html).toContain('id="backlog"');
  });

  it("formats merge-to-pay times", () => {
    expect(formatMinutes(null, "fr")).toBe("—");
    expect(formatMinutes(6, "en")).toBe("6 min");
    expect(formatMinutes(125, "en")).toBe("2 h 05");
    expect(formatMinutes(3 * 1440, "fr")).toBe("3 j");
  });
});

describe("server actions", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("fixtures mode: Pay / Hold answer like the server, invalid input is refused", async () => {
    vi.stubEnv("BITBOUNTY_API_URL", "");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    expect(await decideBounty("b-104", "pay")).toEqual({ ok: true, status: "verified" });
    expect(await decideBounty("b-104", "hold")).toEqual({ ok: true, status: "on_hold" });
    expect(await decideBounty("../etc", "pay")).toEqual({ ok: false, error: "invalid" });
    const s = await suggestBacklog("teranga-labs/bitnob-js");
    expect(s.ok && s.suggestions.length).toBeGreaterThan(0);
  });

  it("real server: posts to the Pay / Hold route and passes its error code through", async () => {
    vi.stubEnv("BITBOUNTY_API_URL", "https://api.test");
    const calls: [string, RequestInit][] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push([url, init]);
        return url.endsWith("/pay")
          ? Response.json({ error: "forbidden" }, { status: 403 })
          : Response.json({ bountyId: "b-1", status: "on_hold" });
      }),
    );
    expect(await decideBounty("b-1", "pay")).toEqual({ ok: false, error: "forbidden" });
    expect(await decideBounty("b-1", "hold", "reverted")).toEqual({ ok: true, status: "on_hold" });
    expect(calls.map(([u]) => u)).toEqual(["https://api.test/api/maintain/bounties/b-1/pay", "https://api.test/api/maintain/bounties/b-1/hold"]);
    expect(JSON.parse(String(calls[1]![1].body))).toEqual({ note: "reverted" });
  });
});

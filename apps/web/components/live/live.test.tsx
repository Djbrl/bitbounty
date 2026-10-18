import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatNgn, formatSats, formatXof, STATUS_META } from "../ui";
import LivePage from "../../app/live/page";
import { LiveBoard } from "./live-board";
import {
  applyTransition,
  countInFlight,
  countPaid,
  findRoute,
  groupByColumn,
  parseRoute,
  parseSpeed,
  reconnectDelay,
  routeAfterSnapshot,
  routeAfterTransition,
  routeStage,
  shortRepo,
  totalPaid,
  type LiveRoute,
  type LiveState,
} from "./live-data";
import { getLiveSnapshot } from "./live-snapshot";
import { connectLive, liveUrl, type EventSourceLike, type LiveConnection } from "./live-stream";
import live from "../../../../fixtures/live.json";
import type { Live } from "../../../../fixtures/types";

const fx = live as unknown as Live;
/** A 300 FCFA bounty funded from Lagos, as the offline e2e run produces it (₦1 = 1/1500 USDT, 1 BTC = 100 000 USDT, 600 FCFA/USDT). */
const ROUTE: LiveRoute = { bountyId: "b-113", ngn: 810, satsBought: 540, xof: 300, feeXof: 15, bufferXof: 9, sats: 500, xofPerBtc: 60_000_000 };
const base = (): LiveState => ({ columns: fx.columns, cards: fx.cards });

describe("live data shaping", () => {
  it("groups cards into the six lanes in order", () => {
    const lanes = groupByColumn(base());
    expect(lanes.map((l) => l.status)).toEqual(["funded", "claimed", "submitted", "verified", "paying", "paid"]);
    expect(lanes.find((l) => l.status === "funded")!.cards.map((c) => c.bountyId)).toEqual(["b-102", "b-112", "b-113"]);
  });

  it("moves a card to the top of its new lane on a fake event", () => {
    const next = applyTransition(base(), { bountyId: "b-113", to: "claimed" });
    const lanes = groupByColumn(next);
    expect(lanes.find((l) => l.status === "claimed")!.cards[0]!.bountyId).toBe("b-113");
    expect(lanes.find((l) => l.status === "funded")!.cards.map((c) => c.bountyId)).not.toContain("b-113");
    expect(next.cards).toHaveLength(fx.cards.length);
  });

  it("ignores events for unknown bounties", () => {
    const s = base();
    expect(applyTransition(s, { bountyId: "nope", to: "paid" })).toBe(s);
  });

  it("replays the whole fixture loop: everything in flight in the events ends up paid", () => {
    let s = base();
    expect(totalPaid(s.cards)).toBe(10_000);
    for (const ev of fx.events) s = applyTransition(s, ev);
    expect(countPaid(s.cards)).toBe(3);
    expect(totalPaid(s.cards)).toBe(10_000 + 7_500 + 10_000);
    expect(countInFlight(s)).toBe(fx.cards.length - 3);
  });

  it("follows the Lagos naira bounty for the route panel", () => {
    expect(getLiveSnapshot().route).toEqual({
      bountyId: "b-113",
      ngn: 29_000,
      satsBought: null,
      xof: 10_000,
      feeXof: 500,
      bufferXof: 300,
      sats: 16_180,
      xofPerBtc: 61_804_697,
    });
    expect(findRoute([], fx.cards)).toBeNull();
    expect([routeStage(undefined), routeStage("funded"), routeStage("paying"), routeStage("paid")]).toEqual([1, 1, 1, 2]);
  });

  it("reads a route off the wire: missing legs become null, a route without naira or FCFA is dropped", () => {
    expect(parseRoute({ ...ROUTE, sats: undefined, xofPerBtc: null, satsBought: "x" })).toEqual({ ...ROUTE, sats: null, xofPerBtc: null, satsBought: null });
    expect(parseRoute(ROUTE)).toEqual(ROUTE);
    for (const bad of [null, undefined, "route", { ...ROUTE, ngn: 0 }, { ...ROUTE, xof: -1 }, { ...ROUTE, bountyId: "" }, { ...ROUTE, ngn: "810" }]) {
      expect(parseRoute(bad)).toBeNull();
    }
  });

  it("follows the route the stream sends: snapshot names it or clears it, transitions update or switch it", () => {
    const other = { ...ROUTE, bountyId: "b-200", sats: null, xofPerBtc: null };
    expect(routeAfterSnapshot(ROUTE, { columns: [], cards: [] } as object)).toBe(ROUTE); // fixture stream: no route key
    expect(routeAfterSnapshot(ROUTE, { route: null })).toBeNull();
    expect(routeAfterSnapshot(null, { route: other })).toEqual(other);
    expect(routeAfterTransition(ROUTE, { route: undefined })).toBe(ROUTE);
    expect(routeAfterTransition(ROUTE, { route: { bad: true } })).toBe(ROUTE);
    expect(routeAfterTransition(other, { route: { ...other, sats: 500, xofPerBtc: 60_000_000 } })).toMatchObject({ bountyId: "b-200", sats: 500 });
  });

  it("parses speed, backoff, urls and repo names", () => {
    expect([parseSpeed(undefined), parseSpeed("4"), parseSpeed("-1"), parseSpeed("x"), parseSpeed("999")]).toEqual([1, 4, 1, 1, 20]);
    expect([0, 1, 2, 3, 4, 9].map(reconnectDelay)).toEqual([1000, 2000, 4000, 8000, 10_000, 10_000]);
    expect(shortRepo("teranga-labs/bitnob-js")).toBe("bitnob-js");
    expect([liveUrl(), liveUrl(4)]).toEqual(["/api/live", "/api/live?speed=4"]);
  });
});

class FakeES implements EventSourceLike {
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  closed = false;
  fns = new Map<string, (e: MessageEvent) => void>();
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.fns.set(type, fn);
  }
  emit(type: string, data: unknown) {
    this.fns.get(type)?.({ data: JSON.stringify(data) } as MessageEvent);
  }
  close() {
    this.closed = true;
  }
}

describe("live SSE client", () => {
  it("applies snapshot + transitions and reconnects with backoff after a drop", () => {
    const sources: FakeES[] = [];
    const timers: { fn: () => void; ms: number }[] = [];
    const conns: LiveConnection[] = [];
    let state: LiveState | null = null;
    const stop = connectLive(
      "/api/live",
      {
        onSnapshot: (s) => (state = s),
        onTransition: (ev) => (state = applyTransition(state!, ev)),
        onConnection: (c) => conns.push(c),
      },
      () => {
        const es = new FakeES();
        sources.push(es);
        return es;
      },
      (fn, ms) => timers.push({ fn, ms }),
    );
    sources[0]!.emit("snapshot", { columns: fx.columns, cards: fx.cards });
    sources[0]!.emit("transition", fx.events[0]);
    expect(state!.cards.find((c) => c.bountyId === "b-113")!.status).toBe("claimed");

    // Drop: close, report, retry after 1 s, then 2 s.
    sources[0]!.onerror!(new Event("error"));
    expect(sources[0]!.closed).toBe(true);
    expect(conns.at(-1)).toBe("reconnecting");
    expect(timers[0]!.ms).toBe(1000);
    timers[0]!.fn();
    sources[1]!.onerror!(new Event("error"));
    expect(timers[1]!.ms).toBe(2000);
    timers[1]!.fn();

    // A fresh snapshot resyncs the board and resets the backoff.
    sources[2]!.emit("snapshot", { columns: fx.columns, cards: fx.cards });
    expect(conns.at(-1)).toBe("live");
    expect(state!.cards.find((c) => c.bountyId === "b-113")!.status).toBe("funded");
    sources[2]!.onerror!(new Event("error"));
    expect(timers[2]!.ms).toBe(1000);

    // Stopped: a pending retry does not reopen.
    stop();
    timers[2]!.fn();
    expect(sources).toHaveLength(3);
  });
});

describe("live render", () => {
  it("renders the six lanes with statusMeta labels, every card and the paid total", () => {
    const html = renderToStaticMarkup(createElement(LiveBoard, { initial: getLiveSnapshot(), stream: false }));
    for (const s of fx.columns) {
      expect(html).toContain(`data-lane="${s}"`);
      expect(html).toContain(STATUS_META[s].label);
    }
    for (const c of fx.cards) expect(html).toContain(`data-card="${c.bountyId}"`);
    expect(html).toContain(formatXof(10_000));
    expect(html).toContain(`₦${formatXof(29_000).replace(/\s*F$/, "")}<`);
    expect(html).toContain("bank transfer · Lagos");
  });

  const board = (route: LiveRoute | null, status: Live["cards"][number]["status"] = "paid") =>
    renderToStaticMarkup(
      createElement(LiveBoard, {
        initial: { columns: fx.columns, cards: fx.cards.map((c) => (c.bountyId === "b-113" ? { ...c, status } : c)), route },
        stream: false,
      }),
    );

  it("shows the naira → bitcoin → FCFA route with the sums behind it (I4)", () => {
    const html = board(ROUTE);
    expect(html).toContain('data-route="b-113"');
    expect(html).toContain("Lagos → Dakar");
    // The three steps, in order.
    const steps = [formatNgn(810), formatSats(540), formatXof(300)].map((s) => html.indexOf(`${s}</b>`));
    expect(steps.every((i) => i > 0)).toBe(true);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
    expect(html).toContain(`${formatSats(500)} · Lightning · Dakar`);
    // 300 + 15 + 9 = 324, and floor(300 × 1e8 ÷ 60 000 000) = 500.
    expect(html).toContain(`${formatNgn(810)} paid for ${formatXof(324)} = ${formatXof(300)} bounty + ${formatXof(15)} fee + ${formatXof(9)} buffer`);
    expect(html).toContain(`${formatXof(300)} paid as ${formatSats(500)} at ${formatXof(60_000_000)}/BTC`);
  });

  it("shows a route with missing legs without inventing numbers", () => {
    const html = board({ ...ROUTE, satsBought: null, feeXof: null, bufferXof: null, sats: null, xofPerBtc: null }, "paying");
    expect(html).toContain(`${formatNgn(810)}</b>`);
    expect(html).toContain("₿</b>");
    expect(html).toContain("paying · Dakar");
    expect(html).not.toContain("paid for");
    expect(html).not.toContain("/BTC");
    expect(board({ ...ROUTE, sats: null, xofPerBtc: null }, "claimed")).toContain("FCFA · Dakar");
  });

  it("shows no route panel without a naira-funded bounty", () => {
    expect(board(null)).not.toContain("data-route");
  });

  it("serves the page from fixtures with ?speed", async () => {
    const el = await LivePage({ searchParams: Promise.resolve({ speed: "4" }) });
    const html = renderToStaticMarkup(el);
    expect(html).toContain("· live");
    expect(html).toContain(`data-theme="dark"`);
  });
});

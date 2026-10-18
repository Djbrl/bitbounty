// CR4 (#132): one failed secondary API call must not take a page down. A fake apiGet fails
// exactly the calls named in `failing`; the main data of each page still comes through.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import board from "../../../fixtures/board.json";
import users from "../../../fixtures/users.json";
import receipts from "../../../fixtures/receipts.json";
import { ApiError } from "./api";

let failing: (path: string) => boolean = () => false;
const responses = new Map<string, unknown>();

vi.mock("./api", async (importOriginal) => {
  const real = await importOriginal<typeof import("./api")>();
  const apiGet = async (path: string) => {
    if (failing(path)) throw new real.ApiError(503, "server_unreachable");
    return responses.has(path) ? responses.get(path) : null;
  };
  return { ...real, apiBaseUrl: () => "http://api.test", apiGet, load: apiGet };
});

import Home from "../app/explore/page";
import { fetchProfile } from "../components/profile/data";
import { fetchLiveSnapshot } from "../components/live/live-snapshot";

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  responses.clear();
  failing = () => false;
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe("board page (/explore)", () => {
  beforeEach(() => responses.set("/api/board", board));

  it("renders when payouts and the issue index fail", async () => {
    failing = (p) => p === "/api/bounties?status=paid" || p === "/api/bounties";
    const html = renderToStaticMarkup(await Home({ searchParams: Promise.resolve({}) }));
    expect(html.length).toBeGreaterThan(0);
    // The project list no longer needs payouts or the issue index, so it may skip those calls.
    expect(warn.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("still fails when the board itself fails", async () => {
    failing = (p) => p === "/api/board";
    await expect(Home({ searchParams: Promise.resolve({}) })).rejects.toBeInstanceOf(ApiError);
  });
});

describe("live snapshot (/live)", () => {
  const card = (bountyId: string, status: string) => ({ bountyId, status, repoFullName: "a/b", issueTitle: bountyId, amountXof: 300, who: null, city: null });
  const PATH = "/api/live?format=json";

  it("reads the server's snapshot, Lagos route included (I4)", async () => {
    const route = { bountyId: "b-2", ngn: 810, satsBought: 540, xof: 300, feeXof: 15, bufferXof: 9, sats: 500, xofPerBtc: 60_000_000 };
    responses.set(PATH, { columns: ["funded", "paid"], cards: [card("b-1", "funded"), card("b-2", "paid")], route });
    const snap = await fetchLiveSnapshot();
    expect(snap.columns).toEqual(["funded", "paid"]);
    expect(snap.cards.map((c) => c.bountyId)).toEqual(["b-1", "b-2"]);
    expect(snap.route).toEqual(route);
  });

  it("keeps the board when the route is missing or unreadable", async () => {
    responses.set(PATH, { cards: [card("b-1", "funded")], route: { bountyId: "b-1", ngn: "lots" } });
    const snap = await fetchLiveSnapshot();
    expect(snap.columns).toHaveLength(6);
    expect(snap.cards).toHaveLength(1);
    expect(snap.route).toBeNull();
  });

  it("still fails when the snapshot fails", async () => {
    failing = (p) => p === PATH;
    await expect(fetchLiveSnapshot()).rejects.toBeInstanceOf(ApiError);
  });
});

describe("profile (/u/[login])", () => {
  const profile = users["awa-ndiaye" as keyof typeof users];
  const receipt = receipts["r-107" as keyof typeof receipts];
  const path = "/api/users/awa-ndiaye";

  it("shows the work item without its receipt when the receipt call fails", async () => {
    responses.set(path, profile);
    failing = (p) => p === "/api/receipts/r-107";
    const view = await fetchProfile("awa-ndiaye");
    expect(view?.work).toHaveLength(1);
    expect(view?.work[0]).toMatchObject({ bitnobReference: null, sats: null, funderLogin: null, signed: false });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("fills the receipt fields when the call works", async () => {
    responses.set(path, profile);
    responses.set("/api/receipts/r-107", receipt);
    const view = await fetchProfile("awa-ndiaye");
    expect(view?.work[0]?.bitnobReference).not.toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("still fails when the profile call fails", async () => {
    failing = (p) => p === path;
    await expect(fetchProfile("awa-ndiaye")).rejects.toBeInstanceOf(ApiError);
  });
});

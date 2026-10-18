import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import me from "../../../../fixtures/me.json";
import MePage from "../../app/me/page";
import { handleMock, type Fixtures } from "../../lib/mock-api";
import { payoutAccountApi } from "./api";
import { loadMe } from "./load-me";
import { addressError, checkAddressInput, formatDateFr, parseMeState, savedAddress } from "./logic";
import { clearBitbountyStorage, DemoReset } from "./demo-reset";
import { Onboarding } from "./onboarding";

describe("checkAddressInput (same LUD-16 rule as the server)", () => {
  it.each([
    ["awa@blink.sv", "awa@blink.sv"],
    [" Awa.Diop@Blink.SV ", "awa.diop@blink.sv"],
    ["moussa+bb@walletofsatoshi.com", "moussa+bb@walletofsatoshi.com"],
  ])("accepts %j", (raw, address) => {
    expect(checkAddressInput(raw)).toEqual({ ok: true, address });
  });

  it.each(["awa", "awa@", "@blink.sv", "awa@@blink.sv", "awa@blink", "awa diop@blink.sv", "+221771234567"])("refuses %j", (raw) => {
    expect(checkAddressInput(raw)).toEqual({ ok: false, error: "format" });
  });

  it("asks for something when empty", () => {
    expect(checkAddressInput("  ")).toEqual({ ok: false, error: "empty" });
  });

  it("has a French message for every server error, a generic one otherwise", () => {
    expect(addressError("lightning_address_unreachable")).toContain("ne répond pas");
    expect(addressError("invalid_lightning_address")).toContain("toi@blink.sv");
    expect(addressError("boom")).toBe("Une erreur est survenue. Réessaie.");
  });
});

describe("helpers", () => {
  it("parseMeState validates ?state=", () => {
    expect(parseMeState("new")).toBe("new");
    expect(parseMeState(["verified", "new"])).toBe("verified");
    expect(parseMeState("bogus")).toBeUndefined();
  });
  it("savedAddress reads the masked Lightning Address", () => {
    expect(savedAddress(loadMe("verified").payoutAccount)).toBe("aw***@blink.sv");
    expect(savedAddress(loadMe("new").payoutAccount)).toBeNull();
  });
  it("formatDateFr", () => {
    expect(formatDateFr("2026-10-17T14:32:00Z")).toBe("17 oct. 2026 à 14:32");
  });
});

describe("api client against the mock API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("saves a Lightning Address: 400 bad format, 422 unreachable, 200 masked", async () => {
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const path = new URL(url, "http://x").pathname.replace(/^\/api\//, "").split("/");
      const res = handleMock({ me } as unknown as Fixtures, init.method ?? "GET", path, new URLSearchParams(), JSON.parse(String(init.body)));
      return new Response(JSON.stringify("json" in res ? res.json : {}), { status: res.status });
    });
    expect(await payoutAccountApi.saveLightningAddress("awa")).toMatchObject({ ok: false, status: 400, error: "invalid_lightning_address" });
    expect(await payoutAccountApi.saveLightningAddress("awa@nowhere.invalid")).toMatchObject({ ok: false, status: 422, error: "lightning_address_unreachable" });
    expect(await payoutAccountApi.saveLightningAddress("awa.diop@blink.sv")).toEqual({ ok: true, data: { lightningAddress: "aw***@blink.sv" } });
  });

  it("reports a network failure instead of throwing", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("offline");
    });
    expect(await payoutAccountApi.saveLightningAddress("awa@blink.sv")).toEqual({ ok: false, status: 0, error: "network_error" });
  });
});

describe("<Onboarding /> and /me", () => {
  const html = (state: "new" | "verified") => renderToStaticMarkup(<Onboarding me={loadMe(state)} />);

  it("asks for a Lightning Address when there is none, never for a phone number", () => {
    const page = html("new");
    expect(page).toContain("Ajoute ta Lightning Address");
    expect(page).toContain("@awa-ndiaye");
    expect(page).toContain('placeholder="toi@blink.sv"');
    expect(page).toContain("Vérifier et enregistrer");
    expect(page).toContain('lang="fr"');
    for (const legacy of ["Wave", "Orange Money", "+221", "SMS", "FCFA"]) expect(page).not.toContain(legacy);
  });

  it("shows the saved address masked", () => {
    const page = html("verified");
    expect(page).toContain("Lightning Address vérifiée");
    expect(page).toContain("aw***@blink.sv");
    expect(page).toContain("Voir les bounties ouvertes");
    expect(page).not.toContain("Wave");
  });

  it("serves /me with ?state= and falls back to the default state", async () => {
    const page = async (state?: string) => renderToStaticMarkup(await MePage({ searchParams: Promise.resolve({ state }) }));
    expect(await page("new")).toContain("Ajoute ta Lightning Address");
    expect(await page("bogus")).toContain("aw***@blink.sv");
  });
});

describe("<DemoReset /> (Zone démo)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders a danger button in French and English, and /me includes it", async () => {
    expect(renderToStaticMarkup(<DemoReset />)).toContain("Réinitialiser la démo");
    expect(renderToStaticMarkup(<DemoReset lang="en" />)).toContain("Reset demo");
    expect(renderToStaticMarkup(await MePage({ searchParams: Promise.resolve({}) }))).toContain("Zone démo");
  });

  it("clears only bitbounty.* localStorage keys", () => {
    const data = new Map([["bitbounty.tour.hunt.done", "1"], ["bitbounty.x", "y"], ["other", "z"]]);
    const storage = {
      get length() { return data.size; },
      key: (i: number) => [...data.keys()][i] ?? null,
      removeItem: (k: string) => void data.delete(k),
    } as unknown as Storage;
    clearBitbountyStorage(storage);
    expect([...data.keys()]).toEqual(["other"]);
    expect(() => clearBitbountyStorage({ get length(): number { throw new Error("blocked"); } } as unknown as Storage)).not.toThrow();
  });

  it("POST /api/me/reset-demo answers {ok:true} in the mock", () => {
    const res = handleMock({ me } as unknown as Fixtures, "POST", ["me", "reset-demo"], new URLSearchParams(), {});
    expect(res).toMatchObject({ status: 200, json: { ok: true } });
  });
});

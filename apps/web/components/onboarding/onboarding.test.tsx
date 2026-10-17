import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import me from "../../../../fixtures/me.json";
import type { Me } from "../../../../fixtures/types";
import MePage from "../../app/me/page";
import { handleMock, type Fixtures } from "../../lib/mock-api";
import { onboardingApi } from "./api";
import { loadMe } from "./load-me";
import {
  attemptsLeftAfterFailure,
  classifyAmountFailure,
  formatCountdown,
  formatDateFr,
  formatSnPhone,
  maskSnPhone,
  MAX_AMOUNT_ATTEMPTS,
  normalizeSnPhone,
  parseAmount,
  parseMeState,
  sanitizeOtp,
  stepFromAccount,
} from "./logic";
import { Onboarding } from "./onboarding";

describe("normalizeSnPhone", () => {
  it.each([
    "77 412 58 30",
    "774125830",
    "+221 77 412 58 30",
    "+221774125830",
    "00221 77 412 58 30",
    "221774125830",
    "77-412-58-30",
    "77.412.58.30",
    " (77) 412 58 30 ",
  ])("accepts %j", (raw) => {
    expect(normalizeSnPhone(raw)).toEqual({ ok: true, national: "774125830", e164: "+221774125830" });
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["77 412 58", "too_short"],
    ["+221 77 412 58 3", "too_short"],
    ["77 412 58 30 1", "too_long"],
    ["+221 77 412 58 30 12", "too_long"],
    ["+33 6 12 34 56 78", "wrong_country"],
    ["0033612345678", "wrong_country"],
    ["33 412 58 30", "bad_prefix"],
    ["77 412 S8 30", "not_digits"],
    ["+2217741258a0", "not_digits"],
  ])("rejects %j (%s)", (raw, error) => {
    expect(normalizeSnPhone(raw)).toEqual({ ok: false, error });
  });

  it("formats and masks like the API", () => {
    expect(formatSnPhone("774125830")).toBe("77 412 58 30");
    expect(maskSnPhone("774125842")).toBe(me.states.verified.payoutAccount.phoneMasked);
  });
});

describe("OTP, amount, attempts", () => {
  it("keeps 6 digits of a pasted code", () => {
    expect(sanitizeOtp("424 242")).toBe("424242");
    expect(sanitizeOtp("Code: 42-42-42-99")).toBe("424242");
    expect(formatCountdown(41)).toBe("0:41");
    expect(formatCountdown(65)).toBe("1:05");
  });

  it("parses what people type as the test amount", () => {
    expect(parseAmount("137")).toBe(137);
    expect(parseAmount(" 137 F ")).toBe(137);
    expect(parseAmount("137 FCFA")).toBe(137);
    expect(parseAmount("1 370")).toBe(1370);
    for (const bad of ["", "0", "13.7", "137,5", "-137", "abc", "137 €"]) expect(parseAmount(bad)).toBeNull();
  });

  it("locks after 3 wrong amounts, trusting the stricter of server and client", () => {
    expect(MAX_AMOUNT_ATTEMPTS).toBe(3);
    // the mock always answers attemptsLeft: 2, so the client count must win
    expect([0, 1, 2].map((n) => attemptsLeftAfterFailure(n, 2))).toEqual([2, 1, 0]);
    expect(attemptsLeftAfterFailure(0, 0)).toBe(0);
    expect(attemptsLeftAfterFailure(5)).toBe(0);
  });

  it("maps account status to the resume step and validates ?state=", () => {
    const S = me.states as unknown as Record<string, Me>;
    expect(["new", "pending", "sms_ok", "verified"].map((s) => stepFromAccount(S[s]!.payoutAccount))).toEqual([
      "account",
      "sms",
      "amount",
      "verified",
    ]);
    expect(parseMeState("sms_ok")).toBe("sms_ok");
    expect(parseMeState(["new", "x"])).toBe("new");
    expect(parseMeState("hacked")).toBeUndefined();
    expect(formatDateFr("2026-10-17T14:32:00Z")).toBe("17 oct. 2026 à 14:32");
  });
});

describe("classifyAmountFailure (server contract: 422 wrong_amount, 423 locked)", () => {
  it("shows attempts left on 422 wrong_amount", () => {
    expect(classifyAmountFailure({ status: 422, error: "wrong_amount", attemptsLeft: 2 }, 0)).toEqual({ kind: "wrong", attemptsLeft: 2 });
    expect(classifyAmountFailure({ status: 422, error: "wrong_amount", attemptsLeft: 0 }, 0)).toEqual({ kind: "locked" });
  });
  it("locks the screen on 423, whatever the local count", () => {
    expect(classifyAmountFailure({ status: 423, error: "locked", attemptsLeft: 0 }, 0)).toEqual({ kind: "locked" });
    expect(classifyAmountFailure({ status: 423, error: "locked" }, 0)).toEqual({ kind: "locked" });
  });
  it("anything else is a plain error", () => {
    expect(classifyAmountFailure({ status: 502, error: "send_failed" }, 0)).toEqual({ kind: "other" });
  });
});

describe("api client against the mock API", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch() {
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const path = new URL(url, "http://x").pathname.replace(/^\/api\//, "").split("/");
      const res = handleMock({ me } as unknown as Fixtures, init.method ?? "GET", path, new URLSearchParams(), JSON.parse(String(init.body)));
      return new Response(JSON.stringify("json" in res ? res.json : {}), { status: res.status });
    });
  }

  it("walks account -> sms -> confirm with the mock code and amount", async () => {
    stubFetch();
    const a = await onboardingApi.createAccount({ provider: "wave", phone: "+221774125830", accountName: "Awa Ndiaye", country: "SN" });
    expect(a.ok && a.data.payoutAccount?.status).toBe("pending");
    expect(await onboardingApi.verifySms("000000")).toMatchObject({ ok: false, status: 422, error: "wrong_code" });
    const s = await onboardingApi.verifySms(me.mock.smsCode);
    expect(s.ok && s.data.payoutAccount?.status).toBe("sms_ok");
    expect(await onboardingApi.confirmAmount(138)).toMatchObject({ ok: false, error: "wrong_amount", attemptsLeft: 2 });
    const c = await onboardingApi.confirmAmount(me.mock.testAmountXof);
    expect(c.ok && c.data.payoutAccount?.status).toBe("verified");
  });

  it("reports a network failure instead of throwing", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("offline");
    });
    expect(await onboardingApi.verifySms("424242")).toEqual({ ok: false, status: 0, error: "network_error" });
  });
});

describe("<Onboarding /> and /me", () => {
  const html = (state: "new" | "pending" | "sms_ok" | "verified") => renderToStaticMarkup(<Onboarding me={loadMe(state)} />);

  it("renders each step in French from the fixture state", () => {
    const step1 = html("new");
    expect(step1).toContain("ÉTAPE 1 / 3");
    expect(step1).toContain("Où veux-tu être payé ?");
    expect(step1).toContain("@awa-ndiaye");
    expect(step1).toContain("Wave");
    expect(step1).toContain("Orange Money");
    expect(step1).toContain("+221");
    expect(step1).toContain('lang="fr"');

    const step2 = html("pending");
    expect(step2).toContain("ÉTAPE 2 / 3");
    expect(step2).toContain("Code reçu par SMS");
    expect(step2).toContain("Envoyé au +221 77 ••• •• 42.");
    expect(step2).toContain('autoComplete="one-time-code"');

    const step3 = html("sms_ok");
    expect(step3).toContain("ÉTAPE 3 / 3");
    expect(step3).toContain("On vient de t&#x27;envoyer un petit montant sur Wave");

    const done = html("verified");
    expect(done).toContain("Paiement vérifié · prêt à recevoir des bounties");
    expect(done).toContain("17 oct. 2026 à 14:32");
    expect(done).toContain("Voir les bounties ouvertes");
    expect(done).not.toContain("ÉTAPE");
  });

  it("serves /me with ?state= and falls back to the default state", async () => {
    const page = async (state?: string) => renderToStaticMarkup(await MePage({ searchParams: Promise.resolve({ state }) }));
    expect(await page("new")).toContain("Où veux-tu être payé ?");
    expect(await page("bogus")).toContain("Paiement vérifié");
    expect(await page()).toContain('data-phone-frame="fluid"');
  });
});

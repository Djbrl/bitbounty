import type { Payout as BitnobPayout } from "@bitbounty/bitnob";
import { BitnobError } from "@bitbounty/bitnob";
import type { PayoutAccount } from "@bitbounty/core";
import { describe, expect, it } from "vitest";
import {
  InMemoryPayoutAccountStore,
  InMemoryTestPayoutStore,
  TestPayoutService,
  maskPhone,
  parseTypedAmount,
  testPayoutRoutes,
} from "../src/onboarding/index.js";
import type { PayoutRails } from "../src/payouts/index.js";

const NOW = new Date("2026-10-17T21:00:00Z");

class FakeRails implements PayoutRails {
  sent: { reference: string; amount: string; to: string }[] = [];
  fail: Error | null = null;
  private n = 0;
  private quotes = new Map<string, { reference: string; amount: string }>();
  async getBanks() {
    return [{ bank_name: "Wave", bank_code: "WAVE_SN" }, { bank_name: "Orange Money", bank_code: "OM_SN" }];
  }
  async createPayoutQuote(input: Parameters<PayoutRails["createPayoutQuote"]>[0]) {
    if (this.fail) throw this.fail;
    const quote_id = `QT-${++this.n}`;
    this.quotes.set(quote_id, { reference: input.reference, amount: input.settlement_amount! });
    return { id: `bp-${this.n}`, quote_id } as unknown as BitnobPayout;
  }
  async initializePayout(quoteId: string, input: Parameters<PayoutRails["initializePayout"]>[1]) {
    const q = this.quotes.get(quoteId)!;
    this.sent.push({ reference: q.reference, amount: q.amount, to: `${input.beneficiary.bank_code}:${input.beneficiary.account_number}` });
    return {} as BitnobPayout;
  }
  async finalizePayout() {
    return undefined;
  }
  async getPayout(): Promise<BitnobPayout> {
    throw new Error("unused");
  }
}

const ACCOUNT: PayoutAccount = {
  userId: "u-awa",
  country: "SN",
  provider: "wave",
  phoneE164: "+221771234567",
  accountName: "Awa Diop",
  status: "sms_ok",
  testAmountXof: null,
  verifiedAt: null,
  lockedUntil: null,
};

function setup(amounts = [137, 152, 188, 101]) {
  const rails = new FakeRails();
  const accounts = new InMemoryPayoutAccountStore();
  const tests = new InMemoryTestPayoutStore();
  accounts.rows.set(ACCOUNT.userId, { ...ACCOUNT });
  let now = NOW;
  const queue = [...amounts];
  const service = new TestPayoutService({
    rails,
    accounts,
    tests,
    callbackUrl: "https://bitbounty.test/webhooks/bitnob",
    now: () => now,
    randomAmount: () => queue.shift()!,
  });
  return { rails, accounts, tests, service, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
}

describe("send", () => {
  it("sends a 100–199 F amount to the linked number and remembers it", async () => {
    const { service, rails, accounts } = setup();
    const test = await service.send("u-awa");
    expect(test).toMatchObject({ amountXof: 137, reference: "test-u-awa-1", status: "sent", phoneE164: "+221771234567" });
    expect(rails.sent).toEqual([{ reference: "test-u-awa-1", amount: "137", to: "WAVE_SN:221771234567" }]);
    expect((await accounts.get("u-awa"))!.testAmountXof).toBe(137);
  });

  it("the default random amount stays within 100–199", async () => {
    const rails = new FakeRails();
    const accounts = new InMemoryPayoutAccountStore();
    const tests = new InMemoryTestPayoutStore();
    const service = new TestPayoutService({ rails, accounts, tests, callbackUrl: "x", maxSends: 1000 });
    for (let i = 0; i < 200; i++) {
      accounts.rows.set(`u${i}`, { ...ACCOUNT, userId: `u${i}` });
      const t = await service.send(`u${i}`);
      expect(t.amountXof).toBeGreaterThanOrEqual(100);
      expect(t.amountXof).toBeLessThanOrEqual(199);
      expect(Number.isInteger(t.amountXof)).toBe(true);
    }
  });

  it("asking again while waiting doesn't send a second payout", async () => {
    const { service, rails } = setup();
    await service.send("u-awa");
    await service.send("u-awa");
    expect(rails.sent).toHaveLength(1);
  });

  it("a double click sends once", async () => {
    const { service, rails } = setup();
    await Promise.all([service.send("u-awa"), service.send("u-awa")]);
    expect(rails.sent).toHaveLength(1);
  });

  it("no account → NO_ACCOUNT; already verified → ALREADY_VERIFIED", async () => {
    const { service, accounts } = setup();
    await expect(service.send("nobody")).rejects.toMatchObject({ code: "NO_ACCOUNT" });
    await accounts.save({ ...ACCOUNT, status: "verified" });
    await expect(service.send("u-awa")).rejects.toMatchObject({ code: "ALREADY_VERIFIED" });
  });

  it("a Bitnob failure is reported and the next send uses a new reference", async () => {
    const { service, rails } = setup();
    rails.fail = new BitnobError("provider down", 503, "HTTP_503");
    await expect(service.send("u-awa")).rejects.toMatchObject({ code: "SEND_FAILED" });
    rails.fail = null;
    expect((await service.send("u-awa")).reference).toBe("test-u-awa-2");
  });

  it("needs the SMS step first: a pending account → SMS_NOT_VERIFIED, nothing sent", async () => {
    const { service, accounts, rails } = setup();
    await accounts.save({ ...ACCOUNT, status: "pending" });
    await expect(service.send("u-awa")).rejects.toMatchObject({ code: "SMS_NOT_VERIFIED" });
    expect(rails.sent).toHaveLength(0);
    // smsVerifiedThenSend moves it to sms_ok and sends.
    await service.smsVerifiedThenSend("u-awa");
    expect((await accounts.get("u-awa"))!.status).toBe("sms_ok");
    expect(rails.sent).toHaveLength(1);
  });

  it("failed sends don't use up the quota and can be retried", async () => {
    const { service, rails, accounts } = setup([137, 152, 188, 101, 120, 130]);
    rails.fail = new BitnobError("provider down", 503, "HTTP_503");
    for (let i = 0; i < 3; i++) await expect(service.send("u-awa")).rejects.toMatchObject({ code: "SEND_FAILED" });
    rails.fail = null;
    for (const phone of ["+221771111111", "+221772222222", "+221773333333"]) {
      await accounts.save({ ...ACCOUNT, phoneE164: phone });
      await service.send("u-awa");
    }
    expect(rails.sent.map((s) => s.reference)).toEqual(["test-u-awa-4", "test-u-awa-5", "test-u-awa-6"]);
    await accounts.save({ ...ACCOUNT, phoneE164: "+221774444444" });
    await expect(service.send("u-awa")).rejects.toMatchObject({ code: "TOO_MANY_TESTS" });
  });

  it("doesn't pass Bitnob's raw error text to the caller", async () => {
    const { service, rails, tests } = setup();
    rails.fail = new BitnobError("internal: wallet 0xdeadbeef balance 3.2 USDT", 500, "HTTP_500");
    const err = (await service.send("u-awa").catch((e: unknown) => e)) as Error;
    expect(err.message).not.toContain("wallet");
    expect((await tests.list("u-awa"))[0]!.error).toContain("wallet");
  });

  it("at most 3 test payouts per account", async () => {
    const { service, accounts } = setup();
    for (const phone of ["+221771111111", "+221772222222", "+221773333333"]) {
      await accounts.save({ ...ACCOUNT, phoneE164: phone });
      await service.send("u-awa");
    }
    await accounts.save({ ...ACCOUNT, phoneE164: "+221774444444" });
    await expect(service.send("u-awa")).rejects.toMatchObject({ code: "TOO_MANY_TESTS" });
  });
});

describe("confirm (reviewer checklist)", () => {
  it("the right amount verifies the account", async () => {
    const { service } = setup();
    await service.send("u-awa");
    const account = await service.confirm("u-awa", "137 FCFA");
    expect(account).toMatchObject({ status: "verified", verifiedAt: NOW.toISOString() });
    // Confirming again is harmless.
    expect((await service.confirm("u-awa", "999")).status).toBe("verified");
  });

  it("a wrong amount says how many tries are left", async () => {
    const { service } = setup();
    await service.send("u-awa");
    await expect(service.confirm("u-awa", "136")).rejects.toMatchObject({ code: "WRONG_AMOUNT", attemptsLeft: 2 });
    await expect(service.confirm("u-awa", "138")).rejects.toMatchObject({ code: "WRONG_AMOUNT", attemptsLeft: 1 });
    expect((await service.confirm("u-awa", "137")).status).toBe("verified");
  });

  it("3 wrong amounts lock it, even the right amount afterwards", async () => {
    const { service, accounts } = setup();
    await service.send("u-awa");
    await expect(service.confirm("u-awa", "1")).rejects.toMatchObject({ code: "WRONG_AMOUNT" });
    await expect(service.confirm("u-awa", "2")).rejects.toMatchObject({ code: "WRONG_AMOUNT" });
    await expect(service.confirm("u-awa", "3")).rejects.toMatchObject({ code: "LOCKED", attemptsLeft: 0 });
    await expect(service.confirm("u-awa", "137")).rejects.toMatchObject({ code: "LOCKED" });
    await expect(service.send("u-awa")).rejects.toMatchObject({ code: "LOCKED" });
    expect((await accounts.get("u-awa"))!.status).not.toBe("verified");
  });

  it("the lock expires after 24 h; a new test is needed", async () => {
    const { service, advance } = setup();
    await service.send("u-awa");
    for (const n of ["1", "2", "3"]) await service.confirm("u-awa", n).catch(() => {});
    advance(24 * 60 * 60_000 + 1);
    await expect(service.confirm("u-awa", "137")).rejects.toMatchObject({ code: "NO_TEST" });
    const next = await service.send("u-awa");
    expect(next.amountXof).toBe(152);
    expect((await service.confirm("u-awa", "152")).status).toBe("verified");
  });

  it("changing the number after the test was sent invalidates it", async () => {
    const { service, accounts, rails } = setup();
    await service.send("u-awa");
    await accounts.save({ ...(await accounts.get("u-awa"))!, phoneE164: "+221779999999" });
    await expect(service.confirm("u-awa", "137")).rejects.toMatchObject({ code: "NUMBER_CHANGED" });
    await expect(service.confirm("u-awa", "137")).rejects.toMatchObject({ code: "NO_TEST" });
    const next = await service.send("u-awa");
    expect(rails.sent.at(-1)!.to).toBe("WAVE_SN:221779999999");
    expect((await service.confirm("u-awa", String(next.amountXof))).status).toBe("verified");
  });

  it("changing the provider also invalidates it, and send() goes to the new one", async () => {
    const { service, accounts, rails } = setup();
    await service.send("u-awa");
    await accounts.save({ ...(await accounts.get("u-awa"))!, provider: "orange" });
    await service.send("u-awa");
    expect(rails.sent.map((s) => s.to)).toEqual(["WAVE_SN:221771234567", "OM_SN:221771234567"]);
    await expect(service.confirm("u-awa", "137")).rejects.toMatchObject({ code: "WRONG_AMOUNT" });
  });

  it("confirm without a test → NO_TEST", async () => {
    const { service } = setup();
    await expect(service.confirm("u-awa", "137")).rejects.toMatchObject({ code: "NO_TEST" });
  });

  it.each(["", "abc", "13.7", "-137", "137 euros", null, {}, 13.7])(
    "unreadable input %j doesn't use up a try",
    async (typed) => {
      const { service } = setup();
      await service.send("u-awa");
      await expect(service.confirm("u-awa", typed)).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
      expect((await service.confirm("u-awa", "137")).status).toBe("verified");
    },
  );
});

describe("confirm under concurrency (review blocker)", () => {
  it("100 parallel guesses 100..199: 3 wrong then locked, never verified", async () => {
    const { service, accounts, tests } = setup([137]);
    await service.send("u-awa");
    // Put the right answer last so the lock must be hit before it is tried.
    const guesses = Array.from({ length: 100 }, (_, i) => 100 + i).filter((n) => n !== 137);
    guesses.push(137);
    const results = await Promise.allSettled(guesses.map((n) => service.confirm("u-awa", String(n))));
    const codes = results.map((r) => (r.status === "fulfilled" ? "OK" : (r.reason as { code: string }).code));
    expect(codes.filter((c) => c === "OK")).toHaveLength(0);
    expect(codes.filter((c) => c === "WRONG_AMOUNT")).toHaveLength(2);
    expect(codes.filter((c) => c === "LOCKED")).toHaveLength(98);
    expect(codes[2]).toBe("LOCKED");
    const account = (await accounts.get("u-awa"))!;
    expect(account.status).not.toBe("verified");
    expect(account.lockedUntil).not.toBeNull();
    // No stale write resets the test to "sent".
    expect((await tests.list("u-awa")).at(-1)).toMatchObject({ status: "locked", wrongTries: 3 });
  });

  it("parallel right answers verify once and the test isn't reopened", async () => {
    const { service, tests } = setup([137]);
    await service.send("u-awa");
    const res = await Promise.all(Array.from({ length: 20 }, () => service.confirm("u-awa", "137")));
    expect(res.every((a) => a.status === "verified")).toBe(true);
    expect((await tests.list("u-awa")).at(-1)!.status).toBe("confirmed");
  });
});

describe("maskPhone", () => {
  it("never shows the full number", () => {
    expect(maskPhone("+221771234567")).toBe("+221 77 ••• •• 67");
    expect(maskPhone("+33612345678")).not.toContain("612345");
  });
});

describe("parseTypedAmount", () => {
  it.each([
    ["137", 137],
    [" 137 ", 137],
    ["137F", 137],
    ["137 fcfa", 137],
    ["1 37", 137],
    [137, 137],
    ["0", null],
    ["", null],
    ["13.7", null],
    [1.5, null],
  ] as const)("%j → %j", (input, expected) => {
    expect(parseTypedAmount(input)).toBe(expected);
  });
});

describe("routes (W4 contract)", () => {
  function app(userId: string | null = "u-awa") {
    const ctx = setup();
    void ctx.accounts.save({ ...ACCOUNT, status: "pending" });
    const http = testPayoutRoutes({
      service: ctx.service,
      getUserId: () => userId,
      checkSmsCode: (_u, code) => code === "424242",
    });
    return { ...ctx, http };
  }
  const post = (http: ReturnType<typeof app>["http"], path: string, body?: unknown) =>
    http.request(`/api/me/payout-account${path}`, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "content-type": "application/json" },
    });

  it("POST /sms with the right code sends the test and returns Me, without the amount or the full number", async () => {
    const { http, rails } = app();
    expect((await post(http, "/sms", { code: "000000" })).status).toBe(422);
    expect(rails.sent).toHaveLength(0);
    const res = await post(http, "/sms", { code: "424242" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ testPayoutSent: true, payoutAccount: { status: "sms_ok", phoneMasked: "+221 77 ••• •• 67" } });
    expect(JSON.stringify(json)).not.toContain("137");
    expect(JSON.stringify(json)).not.toContain("771234567");
    expect(rails.sent).toHaveLength(1);
  });

  it("wrong amount → 422 wrong_amount + attemptsLeft; 3rd → 423 locked; right → Me verified", async () => {
    const { http } = app();
    await post(http, "/sms", { code: "424242" });
    const wrong = await post(http, "/confirm", { amount: 1 });
    expect(wrong.status).toBe(422);
    expect(await wrong.json()).toMatchObject({ error: "wrong_amount", attemptsLeft: 2 });
    expect(await (await post(http, "/confirm", { amount: 2 })).json()).toMatchObject({ error: "wrong_amount", attemptsLeft: 1 });
    const locked = await post(http, "/confirm", { amount: 3 });
    expect(locked.status).toBe(423);
    expect(await locked.json()).toMatchObject({ error: "locked", attemptsLeft: 0 });
    expect((await post(http, "/confirm", { amount: 137 })).status).toBe(423);
  });

  it("right amount → 200 with Me (payoutAccount verified)", async () => {
    const { http } = app();
    await post(http, "/sms", { code: "424242" });
    const ok = await post(http, "/confirm", { amount: 137 });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ payoutAccount: { status: "verified", verifiedAt: NOW.toISOString() } });
  });

  it("a failed send is 502 send_failed with no Bitnob text, and POST /sms again resends", async () => {
    const { http, rails } = app();
    rails.fail = new BitnobError("internal: wallet 0xdeadbeef", 500, "HTTP_500");
    const failed = await post(http, "/sms", { code: "424242" });
    expect(failed.status).toBe(502);
    const body = await failed.json();
    expect(body).toMatchObject({ error: "send_failed" });
    expect(JSON.stringify(body)).not.toContain("wallet");
    rails.fail = null;
    expect((await post(http, "/sms", { code: "424242" })).status).toBe(200);
    expect(rails.sent).toHaveLength(1);
  });

  it("401 when not signed in, 400 on bad JSON", async () => {
    expect((await post(app(null).http, "/sms", { code: "424242" })).status).toBe(401);
    const { http } = app();
    const res = await http.request("/api/me/payout-account/confirm", { method: "POST", body: "{nope" });
    expect(res.status).toBe(400);
  });
});

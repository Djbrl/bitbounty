import { randomInt } from "node:crypto";
import type { PayoutAccount } from "@bitbounty/core";
import { BankCodes, toBitnobBeneficiary, type PayoutRails } from "../payouts/rails.js";

/**
 * B3: proves a developer's mobile money number works before any bounty depends on it.
 * We send a random 100–199 FCFA; they type what they received. Right → account `verified`.
 * 3 wrong answers → locked for `lockMs`. Changing the number cancels the pending test.
 */

export const MIN_TEST_XOF = 100;
export const MAX_TEST_XOF = 199;
export const MAX_WRONG_TRIES = 3;

export interface TestPayout {
  userId: string;
  /** The number and provider the money went to; the test only counts for them. */
  phoneE164: string;
  provider: PayoutAccount["provider"];
  amountXof: number;
  reference: string;
  status: "sent" | "confirmed" | "locked" | "cancelled" | "failed";
  wrongTries: number;
  sentAt: string;
  error: string | null;
}

export interface PayoutAccountStore {
  get(userId: string): Promise<PayoutAccount | undefined>;
  save(account: PayoutAccount): Promise<void>;
}

export interface TestPayoutStore {
  /** Most recent test for this user. */
  latest(userId: string): Promise<TestPayout | undefined>;
  count(userId: string): Promise<number>;
  save(test: TestPayout): Promise<void>;
}

export type TestPayoutErrorCode =
  | "NO_ACCOUNT"
  | "ALREADY_VERIFIED"
  | "LOCKED"
  | "TOO_MANY_TESTS"
  | "SEND_FAILED"
  | "NO_TEST"
  | "NUMBER_CHANGED"
  | "INVALID_AMOUNT"
  | "WRONG_AMOUNT";

export class TestPayoutError extends Error {
  constructor(
    readonly code: TestPayoutErrorCode,
    message: string,
    readonly triesLeft?: number,
    readonly lockedUntil?: string,
  ) {
    super(message);
    this.name = "TestPayoutError";
  }
}

export interface TestPayoutServiceOptions {
  rails: PayoutRails;
  accounts: PayoutAccountStore;
  tests: TestPayoutStore;
  callbackUrl: string;
  fromAsset?: "USDT" | "BTC";
  /** Test payouts a user may receive in total (each one costs us real money in production). */
  maxSends?: number;
  lockMs?: number;
  now?: () => Date;
  /** Returns an integer in [MIN_TEST_XOF, MAX_TEST_XOF]. */
  randomAmount?: () => number;
}

export class TestPayoutService {
  private readonly banks: BankCodes;
  private readonly maxSends: number;
  private readonly lockMs: number;
  private readonly now: () => Date;
  private readonly randomAmount: () => number;

  constructor(private readonly opts: TestPayoutServiceOptions) {
    this.banks = new BankCodes(opts.rails);
    this.maxSends = opts.maxSends ?? 3;
    this.lockMs = opts.lockMs ?? 24 * 60 * 60_000;
    this.now = opts.now ?? (() => new Date());
    this.randomAmount = opts.randomAmount ?? (() => randomInt(MIN_TEST_XOF, MAX_TEST_XOF + 1));
  }

  /** Sends the test amount. Idempotent while a test to the same number is waiting for an answer. */
  send(userId: string): Promise<TestPayout> {
    // A double click must not send two test payouts.
    const running = this.sending.get(userId);
    if (running) return running;
    const p = this.doSend(userId).finally(() => this.sending.delete(userId));
    this.sending.set(userId, p);
    return p;
  }

  private readonly sending = new Map<string, Promise<TestPayout>>();

  private async doSend(userId: string): Promise<TestPayout> {
    const account = await this.account(userId);
    if (account.status === "verified") throw new TestPayoutError("ALREADY_VERIFIED", "this number is already verified");
    this.assertNotLocked(account);

    const last = await this.opts.tests.latest(userId);
    if (last?.status === "sent") {
      if (sameDestination(last, account)) return last;
      await this.opts.tests.save({ ...last, status: "cancelled" });
    }
    const n = (await this.opts.tests.count(userId)) + 1;
    if (n > this.maxSends) {
      throw new TestPayoutError("TOO_MANY_TESTS", `no more than ${this.maxSends} test payouts per account`);
    }

    const amountXof = this.randomAmount();
    if (!Number.isSafeInteger(amountXof) || amountXof < MIN_TEST_XOF || amountXof > MAX_TEST_XOF) {
      throw new Error(`test amount out of range: ${amountXof}`);
    }
    const test: TestPayout = {
      userId,
      phoneE164: account.phoneE164,
      provider: account.provider,
      amountXof,
      reference: `test-${userId}-${n}`,
      status: "sent",
      wrongTries: 0,
      sentAt: this.now().toISOString(),
      error: null,
    };

    try {
      const bankCode = await this.banks.resolve(account.country, account.provider);
      const beneficiary = toBitnobBeneficiary(
        { provider: account.provider, phoneE164: account.phoneE164, accountName: account.accountName, country: account.country },
        bankCode,
      );
      const quote = await this.opts.rails.createPayoutQuote({
        from_asset: this.opts.fromAsset ?? "USDT",
        to_currency: "XOF",
        country: account.country,
        source: "offchain",
        settlement_amount: String(amountXof),
        payment_reason: "account verification",
        reference: test.reference,
      });
      await this.opts.rails.initializePayout(quote.quote_id, {
        reference: test.reference,
        beneficiary,
        callback_url: this.opts.callbackUrl,
        payment_reason: "account verification",
      });
      await this.opts.rails.finalizePayout(quote.quote_id);
    } catch (err) {
      const failed = { ...test, status: "failed" as const, error: err instanceof Error ? err.message : String(err) };
      await this.opts.tests.save(failed);
      throw new TestPayoutError("SEND_FAILED", `the test payout could not be sent: ${failed.error}`);
    }

    await this.opts.tests.save(test);
    await this.opts.accounts.save({ ...account, testAmountXof: amountXof });
    return test;
  }

  /** Checks the amount the developer typed ("137", "137 F", "137 FCFA", "1 3 7"). */
  async confirm(userId: string, typed: unknown): Promise<PayoutAccount> {
    const account = await this.account(userId);
    if (account.status === "verified") return account;
    this.assertNotLocked(account);

    const test = await this.opts.tests.latest(userId);
    if (!test || test.status !== "sent") throw new TestPayoutError("NO_TEST", "no test payout is waiting for confirmation");
    if (!sameDestination(test, account)) {
      await this.opts.tests.save({ ...test, status: "cancelled" });
      throw new TestPayoutError("NUMBER_CHANGED", "the number changed since the test was sent; send a new test");
    }

    const amount = parseTypedAmount(typed);
    if (amount === null) throw new TestPayoutError("INVALID_AMOUNT", "type the amount you received, in FCFA");

    if (amount === test.amountXof) {
      await this.opts.tests.save({ ...test, status: "confirmed" });
      const verified: PayoutAccount = {
        ...account,
        status: "verified",
        verifiedAt: this.now().toISOString(),
        lockedUntil: null,
      };
      await this.opts.accounts.save(verified);
      return verified;
    }

    const wrongTries = test.wrongTries + 1;
    if (wrongTries >= MAX_WRONG_TRIES) {
      const lockedUntil = new Date(this.now().getTime() + this.lockMs).toISOString();
      await this.opts.tests.save({ ...test, wrongTries, status: "locked" });
      await this.opts.accounts.save({ ...account, lockedUntil });
      throw new TestPayoutError("LOCKED", "3 wrong amounts: verification locked", 0, lockedUntil);
    }
    await this.opts.tests.save({ ...test, wrongTries });
    const left = MAX_WRONG_TRIES - wrongTries;
    throw new TestPayoutError("WRONG_AMOUNT", `that's not the amount we sent (${left} ${left === 1 ? "try" : "tries"} left)`, left);
  }

  private async account(userId: string): Promise<PayoutAccount> {
    const account = await this.opts.accounts.get(userId);
    if (!account) throw new TestPayoutError("NO_ACCOUNT", "link a mobile money number first");
    return account;
  }

  private assertNotLocked(account: PayoutAccount) {
    if (account.lockedUntil && Date.parse(account.lockedUntil) > this.now().getTime()) {
      throw new TestPayoutError("LOCKED", "verification is locked, try again later", 0, account.lockedUntil);
    }
  }
}

function sameDestination(test: TestPayout, account: PayoutAccount) {
  return test.phoneE164 === account.phoneE164 && test.provider === account.provider;
}

/** "137", " 137 ", "137 F", "137 FCFA", "137F" → 137. Decimals, negatives, empty → null. */
export function parseTypedAmount(typed: unknown): number | null {
  if (typeof typed === "number") return Number.isSafeInteger(typed) && typed > 0 ? typed : null;
  if (typeof typed !== "string") return null;
  const m = /^\s*([\d\s]{1,10})\s*(f|fcfa|xof|cfa)?\s*$/i.exec(typed);
  if (!m) return null;
  const digits = m[1]!.replace(/\s/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export class InMemoryPayoutAccountStore implements PayoutAccountStore {
  rows = new Map<string, PayoutAccount>();
  async get(userId: string) {
    const r = this.rows.get(userId);
    return r && { ...r };
  }
  async save(account: PayoutAccount) {
    this.rows.set(account.userId, { ...account });
  }
}

export class InMemoryTestPayoutStore implements TestPayoutStore {
  rows: TestPayout[] = [];
  async latest(userId: string) {
    const r = this.rows.filter((t) => t.userId === userId).at(-1);
    return r && { ...r };
  }
  async count(userId: string) {
    return new Set(this.rows.filter((t) => t.userId === userId).map((t) => t.reference)).size;
  }
  async save(test: TestPayout) {
    const i = this.rows.findIndex((t) => t.reference === test.reference);
    if (i >= 0) this.rows[i] = { ...test };
    else this.rows.push({ ...test });
  }
}

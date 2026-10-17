import { randomUUID } from "node:crypto";
import { BitnobError, type BitnobClient, type CreateCustomerInput, type TradingOrder } from "@bitbounty/bitnob";
import { assertAmount } from "@bitbounty/core";
import type { GithubDispatcher } from "../github/dispatcher.js";
import { DEPOSIT_EVENTS, parseEnvelope, toDepositUpdate, type DepositUpdate } from "../bitnob/events.js";
import type { FunderCustomers } from "./customers.js";
import { FundingError, type FundingEvents, type FundingTarget } from "./lightning.js";
import { priceBounty, xofToNaira, type Rates } from "./pricing.js";
import type { FundingRecord, FundingStore } from "./store.js";

/** Bitnob's NGN trading minimum. */
export const MIN_NAIRA = 500;
/**
 * Default cap on one naira bounty. Bitnob refuses quotes above a configured maximum
 * (400 INVALID_AMOUNT) and, in sandbox, above the company-wide NGN balance (422 INSUFFICIENT_FUNDS):
 * on 2026-10-17 the sandbox cap was about ₦3,980. Pass `maxNaira` to match your account.
 */
export const MAX_NAIRA = 5_000_000;
/** A quote with less than this left is treated as expired: the order would race its expiry. */
export const QUOTE_SAFETY_MS = 3_000;

/** A funder's naira account for one bounty, and what has arrived on it. */
export interface NgnAccount {
  fundingId: string;
  bountyId: string;
  virtualAccountId: string;
  accountNumber: string;
  accountName: string;
  bankName: string;
  /** Whole naira needed (bounty + fee + buffer). */
  requiredNaira: number;
  receivedKobo: number;
  /** Deposit references already counted (dedupe across webhook + simulate responses). */
  depositRefs: string[];
  state: "collecting" | "converting" | "converted";
  /** `receivedKobo` when the conversion started: what is sold. Deposits after that are credited, never sold. */
  claimedKobo: number | null;
  /** Last order attempt number; references are `ngn-<fundingId>-<n>`, so n only ever grows. */
  orderAttempt: number;
  /**
   * Reference of the order that may exist at Bitnob, with the quote it was sent with.
   * Kept until that order is known to be refused or failed: re-POSTing the same reference is
   * idempotent (Bitnob returns the existing order), so resume never sells twice.
   */
  orderReference: string | null;
  quoteId: string | null;
  /** Bitnob's order id once we have it. GET /api/trading/orders/:id only accepts the id, not the reference. */
  orderId: string | null;
  btcReceived: string | null;
  lastError: string | null;
}

export interface NgnAccountStore {
  create(account: NgnAccount): Promise<NgnAccount>;
  getByVirtualAccount(virtualAccountId: string): Promise<NgnAccount | undefined>;
  getByFunding(fundingId: string): Promise<NgnAccount | undefined>;
  listByState(state: NgnAccount["state"]): Promise<NgnAccount[]>;
  /** Atomically counts a deposit once. `duplicate` when the reference was already counted. */
  addDeposit(virtualAccountId: string, reference: string, kobo: number): Promise<{ account: NgnAccount; duplicate: boolean } | null>;
  /** Compare-and-set on `state`. */
  update(fundingId: string, expected: NgnAccount["state"], patch: Partial<NgnAccount>): Promise<NgnAccount | null>;
}

export class InMemoryNgnAccountStore implements NgnAccountStore {
  private rows = new Map<string, NgnAccount>();

  async create(a: NgnAccount) {
    this.rows.set(a.fundingId, structuredClone(a));
    return structuredClone(a);
  }
  async getByVirtualAccount(id: string) {
    const r = [...this.rows.values()].find((a) => a.virtualAccountId === id);
    return r && structuredClone(r);
  }
  async getByFunding(fundingId: string) {
    const r = this.rows.get(fundingId);
    return r && structuredClone(r);
  }
  async listByState(state: NgnAccount["state"]) {
    return [...this.rows.values()].filter((a) => a.state === state).map((a) => structuredClone(a));
  }
  async addDeposit(virtualAccountId: string, reference: string, kobo: number) {
    const r = [...this.rows.values()].find((a) => a.virtualAccountId === virtualAccountId);
    if (!r) return null;
    if (r.depositRefs.includes(reference)) return { account: structuredClone(r), duplicate: true };
    r.depositRefs.push(reference);
    r.receivedKobo += kobo;
    return { account: structuredClone(r), duplicate: false };
  }
  async update(fundingId: string, expected: NgnAccount["state"], patch: Partial<NgnAccount>) {
    const r = this.rows.get(fundingId);
    if (!r || r.state !== expected) return null;
    Object.assign(r, patch);
    return structuredClone(r);
  }
}

/** Naira-specific refusals (the shared FundingError covers ALREADY_FUNDED / UNLINKED_DEPOSIT). */
export class NgnFundingError extends Error {
  constructor(
    readonly code: "AMOUNT_TOO_LARGE",
    message: string,
  ) {
    super(message);
    this.name = "NgnFundingError";
  }
}

export interface NgnFundingOptions extends FundingEvents {
  client: Pick<
    BitnobClient,
    "createVirtualAccount" | "simulateDeposit" | "createTradingQuote" | "createTradingOrder" | "getTradingOrder"
  >;
  fundings: FundingStore;
  accounts: NgnAccountStore;
  rates: Rates;
  customers: FunderCustomers;
  /** Bitcoin is the bridge: NGN → BTC (set "USDT" to hold dollars instead). */
  convertTo?: "BTC" | "USDT";
  /** Fresh quotes to try when the order is refused because the quote expired. */
  quoteAttempts?: number;
  /** Largest bounty, in whole naira, we open an account for. Default MAX_NAIRA. */
  maxNaira?: number;
  /** Quotes with less than this left are not used. Default QUOTE_SAFETY_MS. */
  quoteSafetyMs?: number;
  now?: () => Date;
  newId?: () => string;
  log?: Pick<Console, "info" | "warn" | "error">;
}

/**
 * B4: a Lagos company funds a bounty by ordinary bank transfer.
 * Naira account per bounty → deposits (webhook or sandbox simulate) add up →
 * once the full amount is there, naira is sold for bitcoin → `funding.paid`.
 */
export class NgnFunding {
  private readonly convertTo: "BTC" | "USDT";
  private readonly quoteAttempts: number;
  private readonly maxNaira: number;
  private readonly quoteSafetyMs: number;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly log: Pick<Console, "info" | "warn" | "error">;

  constructor(private readonly opts: NgnFundingOptions) {
    this.convertTo = opts.convertTo ?? "BTC";
    this.quoteAttempts = opts.quoteAttempts ?? 3;
    this.maxNaira = opts.maxNaira ?? MAX_NAIRA;
    this.quoteSafetyMs = opts.quoteSafetyMs ?? QUOTE_SAFETY_MS;
    this.now = opts.now ?? (() => new Date());
    this.newId = opts.newId ?? randomUUID;
    this.log = opts.log ?? console;
  }

  /**
   * The naira account the funder transfers to (fund page, "Bank transfer" tab).
   * `identity`: the KYC fields Bitnob requires for a naira account (name, phone, date of birth, id).
   */
  async account(target: FundingTarget, identity: Partial<CreateCustomerInput>): Promise<{ funding: FundingRecord; account: NgnAccount }> {
    assertAmount(target.amountXof, "amountXof");
    const fundings = await this.opts.fundings.listByBounty(target.bountyId);
    if (fundings.some((f) => f.status === "paid")) {
      throw new FundingError("ALREADY_FUNDED", `bounty ${target.bountyId} is already funded`);
    }
    const existing = fundings.find((f) => f.rail === "ngn" && f.status === "pending");
    if (existing) {
      const account = await this.opts.accounts.getByFunding(existing.id);
      if (account) return { funding: existing, account };
    }

    const price = priceBounty(target.amountXof);
    const naira = Math.max(MIN_NAIRA, await xofToNaira(this.opts.rates, price.totalXof));
    if (naira > this.maxNaira) {
      // Bitnob would refuse the quote (above its maximum, or above our NGN balance in sandbox).
      throw new NgnFundingError("AMOUNT_TOO_LARGE", `₦${naira} is above the ₦${this.maxNaira} a naira bounty can convert`);
    }
    const customerId = await this.opts.customers.customerId(target.funderId, { country_code: "NGA", ...identity });
    const va = await this.opts.client.createVirtualAccount({
      customer_id: customerId,
      currency: "NGN",
      reference: `va-${target.bountyId}-${fundings.length + 1}`,
      account_alias: `BitBounty ${target.bountyId}`,
    });

    const funding = await this.opts.fundings.create({
      id: this.newId(),
      bountyId: target.bountyId,
      funderId: target.funderId,
      rail: "ngn",
      sourceAmount: naira * 100,
      sourceCurrency: "NGN",
      bitnobRef: va.id,
      paymentHash: null,
      paymentRequest: null,
      status: "pending",
      paidAt: null,
      amountXof: price.amountXof,
      feeXof: price.feeXof,
      bufferXof: price.bufferXof,
      expiresAt: null,
      createdAt: this.now().toISOString(),
    });
    const account = await this.opts.accounts.create({
      fundingId: funding.id,
      bountyId: target.bountyId,
      virtualAccountId: va.id,
      accountNumber: va.account_number,
      accountName: va.account_name,
      bankName: va.bank_name,
      requiredNaira: naira,
      receivedKobo: 0,
      depositRefs: [],
      state: "collecting",
      claimedKobo: null,
      orderAttempt: 0,
      orderReference: null,
      quoteId: null,
      orderId: null,
      btcReceived: null,
      lastError: null,
    });
    return { funding, account };
  }

  /** A naira deposit arrived (B5 webhook, or a sandbox simulate response). */
  async handleDeposit(deposit: DepositUpdate): Promise<NgnAccount | null> {
    if (!deposit.virtualAccountId || deposit.amountMinor === null || !deposit.reference) {
      this.log.error(`[funding] unreadable naira deposit ignored: ${JSON.stringify(deposit)}`);
      return null;
    }
    if (deposit.currency && deposit.currency.toUpperCase() !== "NGN") {
      this.log.error(`[funding] deposit in ${deposit.currency} on a naira account, ignored: ${deposit.reference}`);
      return null;
    }
    const res = await this.opts.accounts.addDeposit(deposit.virtualAccountId, deposit.reference, deposit.amountMinor);
    if (!res) {
      // Not tied to any bounty: the naira stays on our NGN balance for manual reconciliation.
      this.log.warn(
        `[funding] deposit ${deposit.reference} (${deposit.amountMinor} kobo) on unknown account ${deposit.virtualAccountId}: not linked to a bounty`,
      );
      return null;
    }
    const { account, duplicate } = res;
    if (duplicate) return account;

    if (account.state === "converted") {
      const funding = await this.opts.fundings.get(account.fundingId);
      this.log.warn(`[funding] late deposit ${deposit.reference} on funded bounty ${account.bountyId}, credited to the funder`);
      if (funding) await this.opts.credit?.(funding, `late naira deposit of ${deposit.amountMinor} kobo (${deposit.reference})`);
      return account;
    }
    // Converting: the deposit is counted in receivedKobo but not in claimedKobo. finish() credits
    // it once; if the conversion fails instead, it is sold with the rest on the next attempt.
    if (account.state === "converting") return account;
    if (account.receivedKobo >= account.requiredNaira * 100) return this.convert(account);
    return account;
  }

  /**
   * Sandbox only: simulates transfers (₦1,000 each in sandbox) until the bounty is funded.
   * Stops as soon as a conversion fails (`lastError`): more deposits would not fix a refused quote.
   */
  async simulateUntilFunded(fundingId: string, maxCalls = 500): Promise<NgnAccount> {
    for (let i = 0; i < maxCalls; i++) {
      const account = await this.opts.accounts.getByFunding(fundingId);
      if (!account) throw new Error(`no naira account for funding ${fundingId}`);
      if (account.state !== "collecting") return account;
      // Already covered (an earlier conversion failed): try once more, never deposit more.
      if (account.receivedKobo >= account.requiredNaira * 100) return this.convert(account);
      const sim = await this.opts.client.simulateDeposit(account.virtualAccountId);
      const kobo = /^\d+$/.test(sim.transaction.amount) ? Number(sim.transaction.amount) : null;
      const after = await this.handleDeposit({
        virtualAccountId: account.virtualAccountId,
        reference: sim.transaction.reference,
        amountMinor: kobo,
        currency: sim.transaction.currency,
      });
      if (!after) throw new Error(`simulated deposit ${sim.transaction.reference} was not counted`);
      if (after.lastError) return after;
      const missing = after.requiredNaira * 100 - after.receivedKobo;
      if (after.state === "collecting" && kobo && missing > 0 && Math.ceil(missing / kobo) > maxCalls - i - 1) {
        throw new Error(`₦${after.requiredNaira} needs more than ${maxCalls} simulated deposits of ${kobo} kobo`);
      }
    }
    throw new Error(`still not funded after ${maxCalls} simulated deposits`);
  }

  /** On boot: settles conversions a crash interrupted, retries ones that failed, re-emits a lost funding.paid. */
  async resume(): Promise<void> {
    for (const a of await this.opts.accounts.listByState("converting")) {
      await this.placeOrder(a).catch((err: unknown) => this.log.error(`[funding] resume ${a.fundingId}: ${String(err)}`));
    }
    for (const a of await this.opts.accounts.listByState("collecting")) {
      if (a.receivedKobo >= a.requiredNaira * 100) await this.convert(a).catch(() => {});
    }
    // Crash between `converted` and markPaid: markPaid is compare-and-set, so this emits at most once.
    for (const a of await this.opts.accounts.listByState("converted")) {
      const f = await this.opts.fundings.get(a.fundingId);
      if (f && f.status !== "paid") await this.markPaid(a);
    }
  }

  register(dispatcher: GithubDispatcher): void {
    for (const type of DEPOSIT_EVENTS) {
      dispatcher.on(type, async (event) => {
        const env = parseEnvelope(event.payload);
        const deposit = env && toDepositUpdate(env);
        if (deposit) await this.handleDeposit(deposit);
      });
    }
  }

  /** Claims the account (collecting → converting) and sells the naira. Runs once per account. */
  private async convert(account: NgnAccount): Promise<NgnAccount> {
    const claimed = await this.opts.accounts.update(account.fundingId, "collecting", {
      state: "converting",
      claimedKobo: account.receivedKobo,
      lastError: null,
    });
    if (!claimed) return (await this.opts.accounts.getByFunding(account.fundingId)) ?? account;
    return this.placeOrder(claimed);
  }

  /**
   * Sells `claimedKobo` for bitcoin. First settles any order that may already exist (known id,
   * or a reference sent before a crash or a network error), then takes fresh quotes, re-quoting
   * only when Bitnob says the quote expired. Any other refusal stops with `lastError`.
   */
  private async placeOrder(a: NgnAccount): Promise<NgnAccount> {
    const claimedKobo = a.claimedKobo ?? a.receivedKobo;
    // Trading takes whole naira; any kobo left over stays on the NGN balance.
    const quantity = String(Math.floor(claimedKobo / 100));
    const order = { base_currency: "NGN", quote_currency: this.convertTo, side: "SELL" as const, quantity };

    if (a.orderId) {
      try {
        const known = await this.opts.client.getTradingOrder(a.orderId);
        if (!isFailedOrder(known.status)) return this.settleOrder(a, known, null);
      } catch (err) {
        return this.keepForRetry(a, err);
      }
    } else if (a.orderReference && a.quoteId) {
      // The order may exist: re-POST the same reference. Bitnob returns the existing order if it does.
      try {
        const again = await this.opts.client.createTradingOrder({ ...order, quote_id: a.quoteId, reference: a.orderReference });
        if (!isFailedOrder(again.status)) return this.settleOrder(a, again, null);
      } catch (err) {
        if (isTransient(err)) return this.keepForRetry(a, err);
        if (!isExpiredQuote(err)) return this.fail(a, errorText(err));
        // Never placed and its quote is gone: safe to move on to a new reference.
      }
    }

    let attempt = a.orderAttempt;
    let lastError = "";
    for (let i = 0; i < this.quoteAttempts; i++) {
      attempt++;
      const reference = `ngn-${a.fundingId}-${attempt}`;
      let quoteId: string;
      let receive: string | null;
      try {
        const quote = await this.opts.client.createTradingQuote(order);
        if (Date.parse(quote.expires_at) - this.quoteSafetyMs <= this.now().getTime()) {
          lastError = "quote already expired";
          continue;
        }
        quoteId = quote.id;
        receive = quote.exchange?.receive_quantity ?? null;
      } catch (err) {
        // INVALID_AMOUNT (above max / below min), INSUFFICIENT_FUNDS…: a new quote won't help.
        // Nothing was ordered, so even a network error is safe to fail on (resume retries).
        return this.fail(a, errorText(err));
      }

      // Persist before ordering: if we crash or the network drops, resume re-POSTs this reference.
      const saved = await this.opts.accounts.update(a.fundingId, "converting", {
        orderAttempt: attempt,
        orderReference: reference,
        quoteId,
        orderId: null,
      });
      if (!saved) return (await this.opts.accounts.getByFunding(a.fundingId)) ?? a;
      a = saved;
      try {
        const placed = await this.opts.client.createTradingOrder({ ...order, quote_id: quoteId, reference });
        if (isFailedOrder(placed.status)) {
          lastError = `order ${placed.status}`;
          continue;
        }
        return this.settleOrder(a, placed, receive);
      } catch (err) {
        lastError = errorText(err);
        if (isTransient(err)) return this.keepForRetry(a, err);
        if (!isExpiredQuote(err)) return this.fail(a, lastError);
      }
    }
    return this.fail(a, lastError);
  }

  /** A live order: filled → finish; still pending → keep its id, stay converting, no event yet. */
  private async settleOrder(a: NgnAccount, order: TradingOrder, btcReceived: string | null): Promise<NgnAccount> {
    if (isFilledOrder(order.status)) return this.finish(a, order.id, btcReceived);
    this.log.info(`[funding] naira order ${order.id} for bounty ${a.bountyId} is ${order.status}, checked again on resume`);
    const kept = await this.opts.accounts.update(a.fundingId, "converting", { orderId: order.id, lastError: null });
    return kept ?? a;
  }

  /** Network error / 5xx: the order may or may not exist. Keep the reference; resume re-POSTs it. */
  private async keepForRetry(a: NgnAccount, err: unknown): Promise<NgnAccount> {
    const lastError = errorText(err);
    this.log.warn(`[funding] naira order for bounty ${a.bountyId} unknown (${lastError}), retried on resume`);
    return (await this.opts.accounts.update(a.fundingId, "converting", { lastError })) ?? a;
  }

  /** Refused for good: back to collecting. The last reference is known not to have sold anything. */
  private async fail(a: NgnAccount, lastError: string): Promise<NgnAccount> {
    this.log.error(`[funding] naira conversion failed for bounty ${a.bountyId}: ${lastError}`);
    const back = await this.opts.accounts.update(a.fundingId, "converting", {
      state: "collecting",
      claimedKobo: null,
      orderReference: null,
      quoteId: null,
      orderId: null,
      lastError,
    });
    return back ?? a;
  }

  private async finish(account: NgnAccount, orderId: string, btcReceived: string | null): Promise<NgnAccount> {
    const done = await this.opts.accounts.update(account.fundingId, "converting", {
      state: "converted",
      orderId,
      btcReceived,
      lastError: null,
    });
    if (!done) return (await this.opts.accounts.getByFunding(account.fundingId)) ?? account;
    await this.markPaid(done);
    return done;
  }

  /** markPaid is compare-and-set: whoever wins emits funding.paid and the credits, once. */
  private async markPaid(done: NgnAccount): Promise<void> {
    const res = await this.opts.fundings.markPaid(done.fundingId, this.now().toISOString());
    if (!res) return;
    if (!res.firstForBounty) {
      await this.opts.credit?.(res.funding, "bounty already funded by another payment");
      return;
    }
    this.log.info(`[funding] bounty ${done.bountyId} funded from Lagos: ₦${Math.floor((done.claimedKobo ?? 0) / 100)} → ${done.btcReceived ?? "?"} ${this.convertTo}`);
    await this.opts.emit({
      type: "funding.paid",
      bountyId: done.bountyId,
      occurredAt: this.now().toISOString(),
      fundingId: done.fundingId,
      rail: "ngn",
      amountXof: res.funding.amountXof,
    });
    const claimedKobo = done.claimedKobo ?? done.receivedKobo;
    const overKobo = claimedKobo - done.requiredNaira * 100;
    if (overKobo > 0) await this.opts.credit?.(res.funding, `over-deposit of ${overKobo} kobo`);
    // Deposits that landed while converting: not sold, not yet credited (handleDeposit leaves them).
    const duringKobo = done.receivedKobo - claimedKobo;
    if (duringKobo > 0) await this.opts.credit?.(res.funding, `late naira deposit of ${duringKobo} kobo (during conversion)`);
  }
}

function isFailedOrder(status: string | undefined) {
  return ["cancelled", "canceled", "rejected", "failed", "expired"].includes(String(status ?? "").toLowerCase());
}

/** Seen live on 2026-10-17: the sandbox NGN→BTC order came back `filled`. */
function isFilledOrder(status: string | undefined) {
  return ["filled", "completed", "complete", "success", "successful", "executed", "settled"].includes(
    String(status ?? "").toLowerCase(),
  );
}

/** Only an expired quote is worth a new quote. */
function isExpiredQuote(err: unknown) {
  if (!(err instanceof BitnobError) || err.status < 400 || err.status >= 500) return false;
  return /EXPIRED/i.test(err.code) || /quote.*expired|expired.*quote/i.test(err.message);
}

/** No answer, 429 or 5xx: we don't know whether Bitnob acted. */
function isTransient(err: unknown) {
  return !(err instanceof BitnobError) || err.status === 0 || err.status === 429 || err.status >= 500;
}

function errorText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

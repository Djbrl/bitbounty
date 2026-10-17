import { randomUUID } from "node:crypto";
import { BitnobError, type BitnobClient, type CreateCustomerInput } from "@bitbounty/bitnob";
import { assertAmount } from "@bitbounty/core";
import type { GithubDispatcher } from "../github/dispatcher.js";
import { DEPOSIT_EVENTS, parseEnvelope, toDepositUpdate, type DepositUpdate } from "../bitnob/events.js";
import type { FunderCustomers } from "./customers.js";
import { FundingError, type FundingEvents, type FundingTarget } from "./lightning.js";
import { priceBounty, xofToNaira, type Rates } from "./pricing.js";
import type { FundingRecord, FundingStore } from "./store.js";

/** Bitnob's NGN trading minimum. */
export const MIN_NAIRA = 500;

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
  /** Reference of the NGN→BTC order in flight or done: `ngn-<fundingId>-<n>`. */
  orderReference: string | null;
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
  /** Fresh quotes to try when the order is refused (expired quote). */
  quoteAttempts?: number;
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
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly log: Pick<Console, "info" | "warn" | "error">;

  constructor(private readonly opts: NgnFundingOptions) {
    this.convertTo = opts.convertTo ?? "BTC";
    this.quoteAttempts = opts.quoteAttempts ?? 3;
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
      orderReference: null,
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

    if (account.state !== "collecting") {
      const funding = await this.opts.fundings.get(account.fundingId);
      this.log.warn(`[funding] late deposit ${deposit.reference} on funded bounty ${account.bountyId}, credited to the funder`);
      if (funding) await this.opts.credit?.(funding, `late naira deposit of ${deposit.amountMinor} kobo (${deposit.reference})`);
      return account;
    }
    if (account.receivedKobo >= account.requiredNaira * 100) return this.convert(account);
    return account;
  }

  /** Sandbox only: simulates transfers (₦1,000 each in sandbox) until the bounty is funded. */
  async simulateUntilFunded(fundingId: string, maxCalls = 500): Promise<NgnAccount> {
    for (let i = 0; i < maxCalls; i++) {
      const account = await this.opts.accounts.getByFunding(fundingId);
      if (!account) throw new Error(`no naira account for funding ${fundingId}`);
      if (account.state !== "collecting") return account;
      const sim = await this.opts.client.simulateDeposit(account.virtualAccountId);
      await this.handleDeposit({
        virtualAccountId: account.virtualAccountId,
        reference: sim.transaction.reference,
        amountMinor: /^\d+$/.test(sim.transaction.amount) ? Number(sim.transaction.amount) : null,
        currency: sim.transaction.currency,
      });
    }
    throw new Error(`still not funded after ${maxCalls} simulated deposits`);
  }

  /** On boot: settles conversions a crash interrupted, retries ones that failed. */
  async resume(): Promise<void> {
    for (const a of await this.opts.accounts.listByState("converting")) {
      let order = null;
      if (a.orderReference) {
        order = await this.opts.client.getTradingOrder(a.orderReference).catch(() => null);
      }
      if (order && !isFailedOrder(order.status)) {
        await this.finish(a, order.id, null);
      } else {
        await this.opts.accounts.update(a.fundingId, "converting", { state: "collecting", orderReference: null });
      }
    }
    for (const a of await this.opts.accounts.listByState("collecting")) {
      if (a.receivedKobo >= a.requiredNaira * 100) await this.convert(a).catch(() => {});
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

  /** Sells the naira for bitcoin with a fresh quote, re-quoting if it expired. Runs once per account. */
  private async convert(account: NgnAccount): Promise<NgnAccount> {
    const claimed = await this.opts.accounts.update(account.fundingId, "collecting", { state: "converting" });
    if (!claimed) return (await this.opts.accounts.getByFunding(account.fundingId)) ?? account;
    // Trading takes whole naira; any kobo left over stays on the NGN balance.
    const quantity = String(Math.floor(claimed.receivedKobo / 100));
    let lastError = "";

    for (let n = 1; n <= this.quoteAttempts; n++) {
      const reference = `ngn-${claimed.fundingId}-${n}`;
      try {
        const quote = await this.opts.client.createTradingQuote({
          base_currency: "NGN",
          quote_currency: this.convertTo,
          side: "SELL",
          quantity,
        });
        if (Date.parse(quote.expires_at) <= this.now().getTime()) {
          lastError = "quote already expired";
          continue;
        }
        await this.opts.accounts.update(claimed.fundingId, "converting", { orderReference: reference });
        const order = await this.opts.client.createTradingOrder({
          base_currency: "NGN",
          quote_currency: this.convertTo,
          side: "SELL",
          quantity,
          quote_id: quote.id,
          reference,
        });
        if (isFailedOrder(order.status)) {
          lastError = `order ${order.status}`;
          continue;
        }
        return this.finish(claimed, order.id, quote.exchange?.receive_quantity ?? null);
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        // 4xx = refused (typically the quote expired): a new quote can fix it. Anything else: stop.
        if (!(err instanceof BitnobError && err.status >= 400 && err.status < 500)) break;
      }
    }

    this.log.error(`[funding] naira conversion failed for bounty ${claimed.bountyId}: ${lastError}`);
    const back = await this.opts.accounts.update(claimed.fundingId, "converting", {
      state: "collecting",
      orderReference: null,
      lastError,
    });
    return back ?? claimed;
  }

  private async finish(account: NgnAccount, orderId: string, btcReceived: string | null): Promise<NgnAccount> {
    const done = await this.opts.accounts.update(account.fundingId, "converting", {
      state: "converted",
      orderId,
      btcReceived,
      lastError: null,
    });
    if (!done) return (await this.opts.accounts.getByFunding(account.fundingId)) ?? account;
    const res = await this.opts.fundings.markPaid(account.fundingId, this.now().toISOString());
    if (!res) return done;
    if (res.firstForBounty) {
      this.log.info(`[funding] bounty ${account.bountyId} funded from Lagos: ₦${Math.floor(done.receivedKobo / 100)} → ${btcReceived ?? "?"} ${this.convertTo}`);
      await this.opts.emit({
        type: "funding.paid",
        bountyId: account.bountyId,
        occurredAt: this.now().toISOString(),
        fundingId: account.fundingId,
        rail: "ngn",
        amountXof: res.funding.amountXof,
      });
    } else {
      await this.opts.credit?.(res.funding, "bounty already funded by another payment");
    }
    const extraKobo = done.receivedKobo - done.requiredNaira * 100;
    if (res.firstForBounty && extraKobo > 0) {
      await this.opts.credit?.(res.funding, `over-deposit of ${extraKobo} kobo`);
    }
    return done;
  }
}

function isFailedOrder(status: string | undefined) {
  return ["cancelled", "canceled", "rejected", "failed", "expired"].includes(String(status ?? "").toLowerCase());
}

import { randomUUID } from "node:crypto";
import { BitnobError, type BitnobClient } from "@bitbounty/bitnob";
import { assertAmount, type Bounty, type InternalEvent } from "@bitbounty/core";
import type { FunderCustomers } from "./customers.js";
import { priceBounty, xofToSats, type Rates } from "./pricing.js";
import type { FundingRecord, FundingStore } from "./store.js";

export interface FundingTarget {
  bountyId: string;
  /**
   * What the developer will receive, whole FCFA. Ignored when `bounties` is set: the amount
   * then comes from the stored bounty, never from the caller.
   */
  amountXof?: number;
  funderId: string;
}

export class FundingError extends Error {
  constructor(
    readonly code:       | "ALREADY_FUNDED"
      | "UNLINKED_DEPOSIT"
      | "BOUNTY_NOT_FOUND"
      | "NOT_FUNDABLE"
      | "NO_AMOUNT"
      | "SANDBOX_ONLY"
      | "NO_PENDING_INVOICE",
    message: string,
  ) {
    super(message);
    this.name = "FundingError";
  }
}

export interface FundingEvents {
  /** Publishes `funding.paid` (pg-boss queue in prod). */
  emit: (event: InternalEvent) => void | Promise<void>;
  /**
   * Money that arrived but isn't needed for the bounty (a second invoice paid, an over-deposit).
   * It belongs to the funder: credit their BitBounty balance.
   */
  credit?: (funding: FundingRecord, reason: string) => void | Promise<void>;
}

export interface LightningFundingOptions extends FundingEvents {
  client: Pick<BitnobClient, "createLightningInvoice" | "getLightningInvoice"> &
    Partial<Pick<BitnobClient, "simulateLightningPayment">>;
  /**
   * Gate for `simulatePayment()` (the fund page's "Pay (sandbox)" button). Must answer true only
   * for Bitnob **sandbox** keys (app.ts asks `whoami`). Unset = simulation refused.
   */
  isSandbox?: () => Promise<boolean>;
  store: FundingStore;
  rates: Rates;
  customers: FunderCustomers;
  /**
   * Where bounties live (the shared `bountyRepo` of app.ts). When set, `invoice()` refuses a
   * bounty that isn't `unfunded` (cancelled, already funded…) and takes `amountXof` from it.
   */
  bounties?: { findById(id: string): Promise<Bounty | undefined> };
  /** Invoice lifetime. */
  expirySeconds?: number;
  /**
   * After `expiresAt` + this, a still-pending invoice gets one last check and is then
   * marked expired locally, so it isn't polled forever. Default 10 min.
   */
  expiryGraceMs?: number;
  now?: () => Date;
  newId?: () => string;
  log?: Pick<Console, "info" | "warn" | "error">;
}

/** Bitnob invoice status → ours. Unknown statuses stay pending. */
export function toInvoiceStatus(status: unknown): "pending" | "paid" | "expired" {
  switch (String(status ?? "").toLowerCase()) {
    case "paid":
    case "settled":
    case "success":
    case "successful":
    case "completed":
      return "paid";
    case "expired":
    case "cancelled":
    case "canceled":
    case "failed":
      return "expired";
    default:
      return "pending";
  }
}

/** A new invoice is created when the open one has less than this left. */
const MIN_REMAINING_MS = 60_000;

/**
 * B1: funds a bounty over Lightning.
 * `invoice()` gives the fund page (W3) a payable invoice; `poll()` (Bitnob has no Lightning
 * webhook) watches pending invoices and emits `funding.paid` once per bounty.
 */
export class LightningFunding {
  private readonly expirySeconds: number;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly log: Pick<Console, "info" | "warn" | "error">;
  /** Invoices someone is looking at (fund page open) → polled fast. */
  private readonly hot = new Map<string, number>();
  private readonly expiryGraceMs: number;
  /** Concurrent `invoice()` calls for one bounty share one Bitnob call. */
  private readonly creating = new Map<string, Promise<FundingRecord>>();
  /** Rows whose event is being delivered right now (no double emit from overlapping polls). */
  private readonly delivering = new Set<string>();

  constructor(private readonly opts: LightningFundingOptions) {
    this.expirySeconds = opts.expirySeconds ?? 900;
    this.now = opts.now ?? (() => new Date());
    this.newId = opts.newId ?? randomUUID;
    this.log = opts.log ?? console;
    this.expiryGraceMs = opts.expiryGraceMs ?? 600_000;
  }

  /**
   * Returns a payable invoice for the bounty: the open one if it has time left, else a new one.
   * An older invoice is no longer shown but still watched: if it gets paid anyway, the money counts.
   */
  async invoice(target: FundingTarget): Promise<FundingRecord> {
    const inFlight = this.creating.get(target.bountyId);
    if (inFlight) return inFlight;
    const p = this.openOrCreate(target).finally(() => this.creating.delete(target.bountyId));
    this.creating.set(target.bountyId, p);
    return p;
  }

  private async amountFor(target: FundingTarget): Promise<number> {
    if (!this.opts.bounties) {
      if (target.amountXof === undefined) throw new FundingError("NO_AMOUNT", "amountXof is required without a bounty repo");
      assertAmount(target.amountXof, "amountXof");
      return target.amountXof;
    }
    const bounty = await this.opts.bounties.findById(target.bountyId);
    if (!bounty) throw new FundingError("BOUNTY_NOT_FOUND", `bounty ${target.bountyId} not found`);
    if (bounty.status !== "unfunded") {
      const code = bounty.status === "cancelled" || bounty.status === "refunded" ? "NOT_FUNDABLE" : "ALREADY_FUNDED";
      throw new FundingError(code, `bounty ${target.bountyId} is ${bounty.status}, it can't be funded`);
    }
    assertAmount(bounty.amountXof, "amountXof");
    return bounty.amountXof;
  }

  private openInvoice(fundings: FundingRecord[]): FundingRecord | undefined {
    return fundings
      .filter((f) => f.rail === "lightning" && f.status === "pending" && f.expiresAt)
      .find((f) => Date.parse(f.expiresAt!) - this.now().getTime() > MIN_REMAINING_MS);
  }

  private async openOrCreate(target: FundingTarget): Promise<FundingRecord> {
    const amountXof = await this.amountFor(target);
    const fundings = await this.opts.store.listByBounty(target.bountyId);
    if (fundings.some((f) => f.status === "paid")) {
      throw new FundingError("ALREADY_FUNDED", `bounty ${target.bountyId} is already funded`);
    }
    const open = this.openInvoice(fundings);
    if (open) return open;

    const price = priceBounty(amountXof);
    const sats = await xofToSats(this.opts.rates, price.totalXof);
    assertAmount(sats, "sats");
    const customerId = await this.opts.customers.customerId(target.funderId);
    const create = (reference: string) =>
      this.opts.client.createLightningInvoice({
        customer_id: customerId,
        amount: sats,
        description: `BitBounty bounty ${target.bountyId}`,
        expiry: this.expirySeconds,
        reference,
      });
    const reference = `fund-${target.bountyId}-${fundings.length + 1}`;
    let inv;
    try {
      inv = await create(reference);
    } catch (err) {
      if (!isDuplicateReference(err)) throw err;
      // Another call (another process) already created this reference: share its invoice.
      const shared = this.openInvoice(await this.opts.store.listByBounty(target.bountyId));
      if (shared) return shared;
      // The reference is taken by an invoice we never stored (crash between create and store): new one.
      this.log.warn(`[funding] reference ${reference} already used on Bitnob; retrying with a fresh one`);
      inv = await create(`${reference}-${this.newId().slice(0, 8)}`);
    }

    const created = this.now();
    return this.opts.store.create({
      id: this.newId(),
      bountyId: target.bountyId,
      funderId: target.funderId,
      rail: "lightning",
      sourceAmount: sats,
      sourceCurrency: "BTC",
      bitnobRef: inv.id,
      paymentHash: inv.payment_hash ?? null,
      paymentRequest: inv.request ?? null,
      status: "pending",
      paidAt: null,
      amountXof: price.amountXof,
      feeXof: price.feeXof,
      bufferXof: price.bufferXof,
      expiresAt: inv.expires_at ?? new Date(created.getTime() + this.expirySeconds * 1000).toISOString(),
      createdAt: created.toISOString(),
    });
  }

  /** True only when simulated payments are allowed (Bitnob sandbox keys, BITNOB_SANDBOX_PAY not 0). */
  async canSimulate(): Promise<boolean> {
    if (!this.opts.client.simulateLightningPayment || !this.opts.isSandbox) return false;
    return this.opts.isSandbox().catch(() => false);
  }

  /**
   * Sandbox only: settles the bounty's open Lightning invoice with Bitnob's simulate-payment,
   * then checks it so the normal paid flow (`funding.paid`) runs at once. Already paid → no call.
   */
  async simulatePayment(bountyId: string): Promise<FundingRecord> {
    const simulate = this.opts.client.simulateLightningPayment?.bind(this.opts.client);
    if (!simulate || !(await this.canSimulate())) {
      throw new FundingError("SANDBOX_ONLY", "simulated payments need Bitnob sandbox keys");
    }
    const fundings = (await this.opts.store.listByBounty(bountyId)).filter((f) => f.rail === "lightning");
    const paid = fundings.find((f) => f.status === "paid");
    if (paid) return paid;
    const pending = fundings.filter((f) => f.status === "pending");
    const target =
      this.openInvoice(pending) ?? [...pending].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!target) throw new FundingError("NO_PENDING_INVOICE", `bounty ${bountyId} has no pending Lightning invoice`);
    await simulate(target.bitnobRef);
    this.log.info(`[funding] sandbox: simulated payment of invoice ${target.bitnobRef} (bounty ${bountyId})`);
    this.watch(target.id);
    return (await this.check(target.id)) ?? target;
  }

  /** Marks an invoice as being watched (fund page open): polled every fast tick for 2 minutes. */
  watch(fundingId: string) {
    this.hot.set(fundingId, this.now().getTime() + 120_000);
  }

  /** Asks Bitnob about one invoice and applies the result. */
  async check(fundingId: string): Promise<FundingRecord | undefined> {
    const f = await this.opts.store.get(fundingId);
    if (!f || f.rail !== "lightning" || f.status !== "pending") return f;
    const inv = await this.opts.client.getLightningInvoice(f.bitnobRef);
    const status = toInvoiceStatus(inv.status);
    if (status === "paid") await this.paid(f);
    if (status === "expired") await this.opts.store.markExpired(f.id);
    if (status === "pending" && f.expiresAt && Date.parse(f.expiresAt) + this.expiryGraceMs < this.now().getTime()) {
      // Bitnob still says pending well past expiry: stop polling it.
      this.log.warn(`[funding] invoice ${f.bitnobRef} still pending ${this.expiryGraceMs / 1000} s after expiry; marked expired`);
      await this.opts.store.markExpired(f.id);
      this.hot.delete(f.id);
    }
    return this.opts.store.get(fundingId);
  }

  /** One polling pass. `onlyHot`: just the invoices someone is looking at. */
  async poll(onlyHot = false): Promise<void> {
    // Outbox first: paid rows whose event never got out (emit threw, crash) are delivered again.
    for (const f of await this.opts.store.listUnnotified("lightning")) {
      await this.deliver(f).catch((err) =>
        this.log.error(`[funding] delivery for ${f.id} failed, retrying next poll: ${errMessage(err)}`),
      );
    }
    const t = this.now().getTime();
    for (const f of await this.opts.store.listPending("lightning")) {
      const hotUntil = this.hot.get(f.id);
      if (hotUntil !== undefined && hotUntil < t) this.hot.delete(f.id);
      if (onlyHot && !(hotUntil && hotUntil >= t)) continue;
      await this.check(f.id).catch((err) =>
        this.log.error(`[funding] invoice ${f.bitnobRef} check failed: ${errMessage(err)}`),
      );
    }
  }

  /** Watched invoices every `fastMs` (3 s), all pending invoices every `slowMs` (30 s). */
  startPolling(fastMs = 3_000, slowMs = 30_000): () => void {
    let elapsed = 0;
    let running = false;
    const timer = setInterval(() => {
      elapsed += fastMs;
      // A slow Bitnob must not pile up overlapping passes; a skipped full pass runs on the next free tick.
      if (running) return;
      const all = elapsed >= slowMs;
      if (all) elapsed = 0;
      running = true;
      void this.poll(!all)
        .catch((err) => this.log.error(`[funding] poll failed: ${errMessage(err)}`))
        .finally(() => (running = false));
    }, fastMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  private async paid(f: FundingRecord) {
    const res = await this.opts.store.markPaid(f.id, this.now().toISOString());
    if (!res) return; // already handled (the outbox covers a delivery that failed)
    this.hot.delete(f.id);
    if (res.firstForBounty) {
      this.log.info(`[funding] bounty ${f.bountyId} funded over Lightning (${f.sourceAmount} sats)`);
    } else {
      this.log.warn(`[funding] bounty ${f.bountyId} was already funded; invoice ${f.bitnobRef} credited to the funder`);
    }
    // If this throws, the row stays un-notified and the next poll() delivers it again.
    await this.deliver(res.funding);
  }

  /**
   * Emits `funding.paid` (or credits the funder) for a paid row, then marks it notified.
   * At least once: a second `funding.paid` for a bounty is rejected by `transition()`, so the
   * consumer must treat it as already applied.
   */
  private async deliver(f: FundingRecord) {
    if (this.delivering.has(f.id)) return;
    this.delivering.add(f.id);
    try {
      if (f.fundsBounty === false) {
        await this.opts.credit?.(f, "bounty already funded by another payment");
      } else {
        await this.opts.emit({
          type: "funding.paid",
          bountyId: f.bountyId,
          occurredAt: f.paidAt ?? this.now().toISOString(),
          fundingId: f.id,
          rail: "lightning",
          amountXof: f.amountXof,
        });
      }
      await this.opts.store.markNotified(f.id, this.now().toISOString());
    } finally {
      this.delivering.delete(f.id);
    }
  }
}

function errMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

/** Bitnob 409 DUPLICATE_KEY_ERROR: the invoice `reference` already exists. */
export function isDuplicateReference(err: unknown): boolean {
  return err instanceof BitnobError && (err.status === 409 || err.code === "DUPLICATE_KEY_ERROR");
}

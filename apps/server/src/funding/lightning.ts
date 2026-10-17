import { randomUUID } from "node:crypto";
import type { BitnobClient } from "@bitbounty/bitnob";
import { assertAmount, type InternalEvent } from "@bitbounty/core";
import type { FunderCustomers } from "./customers.js";
import { priceBounty, xofToSats, type Rates } from "./pricing.js";
import type { FundingRecord, FundingStore } from "./store.js";

export interface FundingTarget {
  bountyId: string;
  /** What the developer will receive, whole FCFA. */
  amountXof: number;
  funderId: string;
}

export class FundingError extends Error {
  constructor(
    readonly code: "ALREADY_FUNDED" | "UNLINKED_DEPOSIT",
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
  client: Pick<BitnobClient, "createLightningInvoice" | "getLightningInvoice">;
  store: FundingStore;
  rates: Rates;
  customers: FunderCustomers;
  /** Invoice lifetime. */
  expirySeconds?: number;
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

  constructor(private readonly opts: LightningFundingOptions) {
    this.expirySeconds = opts.expirySeconds ?? 900;
    this.now = opts.now ?? (() => new Date());
    this.newId = opts.newId ?? randomUUID;
    this.log = opts.log ?? console;
  }

  /**
   * Returns a payable invoice for the bounty: the open one if it has time left, else a new one.
   * An older invoice is no longer shown but still watched: if it gets paid anyway, the money counts.
   */
  async invoice(target: FundingTarget): Promise<FundingRecord> {
    assertAmount(target.amountXof, "amountXof");
    const fundings = await this.opts.store.listByBounty(target.bountyId);
    if (fundings.some((f) => f.status === "paid")) {
      throw new FundingError("ALREADY_FUNDED", `bounty ${target.bountyId} is already funded`);
    }
    const open = fundings
      .filter((f) => f.rail === "lightning" && f.status === "pending" && f.expiresAt)
      .find((f) => Date.parse(f.expiresAt!) - this.now().getTime() > MIN_REMAINING_MS);
    if (open) return open;

    const price = priceBounty(target.amountXof);
    const sats = await xofToSats(this.opts.rates, price.totalXof);
    assertAmount(sats, "sats");
    const customerId = await this.opts.customers.customerId(target.funderId);
    const reference = `fund-${target.bountyId}-${fundings.length + 1}`;
    const inv = await this.opts.client.createLightningInvoice({
      customer_id: customerId,
      amount: sats,
      description: `BitBounty bounty ${target.bountyId}`,
      expiry: this.expirySeconds,
      reference,
    });

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
    return this.opts.store.get(fundingId);
  }

  /** One polling pass. `onlyHot`: just the invoices someone is looking at. */
  async poll(onlyHot = false): Promise<void> {
    const t = this.now().getTime();
    for (const f of await this.opts.store.listPending("lightning")) {
      const hotUntil = this.hot.get(f.id);
      if (hotUntil !== undefined && hotUntil < t) this.hot.delete(f.id);
      if (onlyHot && !(hotUntil && hotUntil >= t)) continue;
      await this.check(f.id).catch((err) =>
        this.log.error(`[funding] invoice ${f.bitnobRef} check failed: ${err instanceof Error ? err.message : err}`),
      );
    }
  }

  /** Watched invoices every `fastMs` (3 s), all pending invoices every `slowMs` (30 s). */
  startPolling(fastMs = 3_000, slowMs = 30_000): () => void {
    let elapsed = 0;
    const timer = setInterval(() => {
      elapsed += fastMs;
      const all = elapsed >= slowMs;
      if (all) elapsed = 0;
      void this.poll(!all);
    }, fastMs);
    return () => clearInterval(timer);
  }

  private async paid(f: FundingRecord) {
    const res = await this.opts.store.markPaid(f.id, this.now().toISOString());
    if (!res) return; // already handled
    this.hot.delete(f.id);
    if (res.firstForBounty) {
      this.log.info(`[funding] bounty ${f.bountyId} funded over Lightning (${f.sourceAmount} sats)`);
      await this.opts.emit({
        type: "funding.paid",
        bountyId: f.bountyId,
        occurredAt: this.now().toISOString(),
        fundingId: f.id,
        rail: "lightning",
        amountXof: f.amountXof,
      });
    } else {
      this.log.warn(`[funding] bounty ${f.bountyId} was already funded; invoice ${f.bitnobRef} credited to the funder`);
      await this.opts.credit?.(res.funding, "bounty already funded by another payment");
    }
  }
}

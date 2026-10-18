import { randomUUID } from "node:crypto";
import { BitnobError, type BitnobClient, type LightningPayment } from "@bitbounty/bitnob";
import { assertAmount, maskLightningAddress, type InternalEvent, type Payout } from "@bitbounty/core";
import { parseEnvelope } from "../bitnob/events.js";
import type { Rates } from "../funding/pricing.js";
import type { GithubDispatcher } from "../github/dispatcher.js";
import { LnurlError, type LnurlResolver } from "./lnurl.js";
import { PayoutConfigError, maskPhones } from "./rails.js";
import type { PayoutStore } from "./store.js";

/** The Bitnob calls a Lightning payout needs. `BitnobClient` satisfies it; tests pass a fake. */
export type LightningRails = Pick<BitnobClient, "payLightningInvoice" | "getLightningPayment">;

/** Where the developer is paid. */
export interface Payee {
  /** Lightning Address, e.g. `awa@blink.sv`. */
  lightningAddress: string;
}

export interface PayoutServiceOptions {
  rails: LightningRails;
  /** Lightning Address → BOLT11 for the exact amount (LNURL-pay). */
  resolver: LnurlResolver;
  /** Same rates as Lightning funding (B1): FCFA per USDT and USDT per BTC. */
  rates: Pick<Rates, "xofPerUsdt" | "usdtPerBtc">;
  store: PayoutStore;
  /**
   * Publishes `payout.started` / `payout.succeeded` / `payout.failed`. For `payout.started` it is
   * also the gate: it must move the bounty to `paying` and **throw** if it couldn't; then nothing
   * is sent to Bitnob (Settlement.applyPayoutEvent does exactly that).
   */
  emit: (event: InternalEvent) => void | Promise<void>;
  /** The developer's payout account, read at every attempt (they may fix their address). */
  getPayee: (userId: string) => Promise<Payee>;
  /**
   * Bitnob `customer_id` sent with every payment (`BITNOB_PAYOUT_CUSTOMER_ID`). The v2 spec lists
   * it as required; unverified, since the sandbox refuses `send_lightning` on our account. One
   * fixed id, so a replay sends exactly the same body, also after a restart.
   */
  customerId?: string;
  /** Routing fee cap in sats for a payment of `sats`. Default max(10, 1%). */
  maxFeeSats?: (sats: number) => number;
  maxAttempts?: number;
  /** Wait before attempt 2, 3, … (the last value repeats). */
  retryDelaysMs?: number[];
  schedule?: (fn: () => void, ms: number) => void;
  now?: () => Date;
  newId?: () => string;
  log?: Pick<Console, "info" | "warn" | "error">;
}

export interface PayoutRequest {
  bountyId: string;
  userId: string;
  amountXof: number;
}

/** A Lightning payment status from Bitnob (pay answer, poll or webhook). */
export interface LightningUpdate {
  /** Our per-attempt reference, `pay-<bountyId>-<attempt>`. */
  reference: string | null;
  bitnobPaymentId: string | null;
  status: string | null;
  preimage?: string | null;
}

export type LightningOutcome = "success" | "failed" | "processing";

/** Any Bitnob Lightning status → ours. A preimage is proof of payment. Unknown statuses wait. */
export function toLightningOutcome(status: unknown, preimage?: unknown): LightningOutcome {
  switch (String(status ?? "").trim().toLowerCase()) {
    case "paid":
    case "settled":
    case "success":
    case "successful":
    case "succeeded":
    case "completed":
    case "complete":
      return "success";
    case "failed":
    case "failure":
    case "expired":
    case "cancelled":
    case "canceled":
    case "rejected":
    case "reversed":
    case "error":
      return "failed";
    default:
      return typeof preimage === "string" && /^[0-9a-f]{64}$/i.test(preimage) ? "success" : "processing";
  }
}

/** FCFA → sats for a payout: integer, rounded down (we never send more than the bounty). */
export async function payoutSats(
  rates: Pick<Rates, "xofPerUsdt" | "usdtPerBtc">,
  amountXof: number,
): Promise<{ sats: number; xofPerBtc: number }> {
  const [xofUsdt, usdtBtc] = await Promise.all([rates.xofPerUsdt(), rates.usdtPerBtc()]);
  const xofPerBtc = xofUsdt * usdtBtc;
  if (!Number.isFinite(xofPerBtc) || xofPerBtc <= 0) throw new Error(`unusable BTC/XOF rate ${xofPerBtc}`);
  return { sats: Math.floor((amountXof * 1e8) / xofPerBtc), xofPerBtc };
}

const REF = /^(pay-.+)-(\d+)$/;

/**
 * Pays a bounty to the developer's Lightning Address: LNURL-pay → BOLT11 for the exact amount
 * → Bitnob `POST /api/lightning/pay`, up to `maxAttempts` attempts, never twice.
 *
 * Order of an attempt (each step saved with a compare-and-set before the next one):
 *   1. claim the row (pending → processing, attempts n);
 *   2. `payout.started` moves the bounty to `paying`. If that fails, the claim is undone and
 *      **nothing is sent to Bitnob**;
 *   3. rate → sats (rounded down), LNURL-pay → invoice checked (amount, network, expiry), saved;
 *   4. `sentAt` saved, then exactly one `POST /api/lightning/pay` with reference `pay-<bountyId>-<n>`.
 *
 * Why it can't pay twice:
 * - one row per bounty and compare-and-set on (status, attempts): one worker per attempt;
 * - the pay call is sent once (`retries: 0`). After an unclear answer (timeout, 5xx, 409) the
 *   attempt stays `processing` until Bitnob says paid or failed;
 * - to find out, we read the payment by its Bitnob id, or, if the answer was lost before we got an
 *   id, we replay **the same reference with the same invoice**. That is not a second payment:
 *   Bitnob's pay is idempotent on `reference`, and a BOLT11 has one payment hash, which Lightning
 *   settles at most once;
 * - a new attempt (new invoice, new reference) starts only after Bitnob **confirmed** the
 *   previous one failed, or it was never sent (`sentAt` unset, or Bitnob refused the request).
 */
export class PayoutService {
  private readonly rails: LightningRails;
  private readonly resolver: LnurlResolver;
  private readonly rates: PayoutServiceOptions["rates"];
  private readonly store: PayoutStore;
  private readonly emit: PayoutServiceOptions["emit"];
  private readonly getPayee: PayoutServiceOptions["getPayee"];
  private readonly customerId?: PayoutServiceOptions["customerId"];
  private readonly maxFeeSats: (sats: number) => number;
  private readonly maxAttempts: number;
  private readonly retryDelaysMs: number[];
  private readonly schedule: (fn: () => void, ms: number) => void;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly log: Pick<Console, "info" | "warn" | "error">;
  /** Payout ids being driven in this process, so polling doesn't race an attempt. */
  private readonly inFlight = new Set<string>();

  constructor(opts: PayoutServiceOptions) {
    this.rails = opts.rails;
    this.resolver = opts.resolver;
    this.rates = opts.rates;
    this.store = opts.store;
    this.emit = opts.emit;
    this.getPayee = opts.getPayee;
    this.customerId = opts.customerId;
    this.maxFeeSats = opts.maxFeeSats ?? ((sats) => Math.max(10, Math.ceil(sats / 100)));
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.retryDelaysMs = opts.retryDelaysMs ?? [5_000, 30_000];
    this.schedule = opts.schedule ?? ((fn, ms) => void setTimeout(fn, ms));
    this.now = opts.now ?? (() => new Date());
    this.newId = opts.newId ?? randomUUID;
    this.log = opts.log ?? console;
  }

  /** Starts paying a bounty. Safe to call any number of times for the same bounty. */
  async start(req: PayoutRequest): Promise<Payout> {
    assertAmount(req.amountXof, "amountXof");
    const { payout } = await this.store.create({
      id: this.newId(),
      bountyId: req.bountyId,
      userId: req.userId,
      amountXof: req.amountXof,
      quoteId: null,
      bitnobPayoutId: null,
      reference: `pay-${req.bountyId}`,
      status: "pending",
      attempts: 0,
      lastError: null,
      paidAt: null,
      rail: "lightning",
    });
    if (payout.userId !== req.userId || payout.amountXof !== req.amountXof) {
      throw new Error(`bounty ${req.bountyId} already has a payout to another user or for another amount`);
    }
    if (payout.status !== "pending") return payout;
    return this.attempt(payout);
  }

  /** Applies a webhook or polling result. Returns null when the payment isn't one of ours. */
  async handleUpdate(update: LightningUpdate): Promise<Payout | null> {
    let row = update.bitnobPaymentId ? await this.store.findByBitnob({ bitnobPayoutId: update.bitnobPaymentId }) : undefined;
    const m = update.reference ? REF.exec(update.reference) : null;
    if (!row && m) {
      const byRef = await this.store.getByBounty(m[1]!.slice("pay-".length));
      if (byRef?.reference === m[1]) row = byRef;
    }
    if (!row) return null;
    // Duplicates and late events (e.g. `pending` after `paid`) land here.
    if (row.status !== "processing" || !row.sentAt) return row;
    // An event about an earlier attempt must not touch the current one.
    if (m && Number(m[2]) !== row.attempts) return row;
    if (update.bitnobPaymentId && row.bitnobPayoutId && update.bitnobPaymentId !== row.bitnobPayoutId) return row;
    return this.apply(row, {
      id: update.bitnobPaymentId ?? undefined,
      status: update.status ?? undefined,
      preimage: update.preimage ?? undefined,
    });
  }

  /** Asks Bitnob about every payout still `processing` (Lightning has no documented webhook). */
  async poll(): Promise<void> {
    let rows: Payout[];
    try {
      rows = await this.store.listByStatus("processing");
    } catch (err) {
      // Never let a database hiccup reject the polling timer (an unhandled rejection kills the server).
      this.log.error(`[payouts] poll: payouts not readable: ${safe(err)}`);
      return;
    }
    for (const row of rows) {
      if (this.inFlight.has(row.id)) continue;
      await this.drive(row, false).catch((err) => this.log.error(`[payouts] poll failed for ${row.reference}: ${safe(err)}`));
    }
  }

  /**
   * On boot: finish what a crash interrupted. Runs every `pending` row (never claimed, lost retry
   * timer, or a start the bounty refused), then polls the `processing` ones.
   */
  async resume(): Promise<void> {
    for (const row of await this.store.listByStatus("pending")) {
      await this.attempt(row).catch((err) => this.log.error(`[payouts] resume: ${safe(err)}`));
    }
    await this.poll();
  }

  startPolling(intervalMs = 15_000): () => void {
    const timer = setInterval(() => void this.poll(), intervalMs);
    return () => clearInterval(timer);
  }

  /**
   * Bitnob documents no Lightning webhook; if one arrives (B5 receiver) whose `data.reference`
   * is one of our attempts (`pay-<bountyId>-<n>`), it is applied like a poll result.
   * Mobile money events (`payouts.*`) are not ours any more.
   */
  register(dispatcher: GithubDispatcher): void {
    dispatcher.on("*", async (event) => {
      if (event.source !== "bitnob") return;
      const env = parseEnvelope(event.payload);
      if (!env || env.type.startsWith("payouts.")) return;
      const d = env.data;
      const reference = typeof d.reference === "string" ? d.reference : null;
      if (!reference || !REF.test(reference)) return;
      const suffix = /\.(success|successful|paid|settled|failed|expired)$/.exec(env.type)?.[1];
      await this.handleUpdate({
        reference,
        bitnobPaymentId: typeof d.id === "string" ? d.id : null,
        status: typeof d.status === "string" ? d.status : (suffix ?? null),
        preimage: typeof d.preimage === "string" ? d.preimage : null,
      });
    });
  }

  private async attempt(p: Payout): Promise<Payout> {
    if (p.attempts >= this.maxAttempts || !isLightning(p)) return p;
    const n = p.attempts + 1;
    const claimed = await this.store.update(
      p.id,
      { status: "pending", attempts: p.attempts },
      { status: "processing", attempts: n, rail: "lightning", lastError: null, ...EMPTY_ATTEMPT },
    );
    if (!claimed) return (await this.store.get(p.id)) ?? p;
    const gated = await this.gate(claimed);
    if (gated !== true) return gated;
    return this.drive(claimed, true);
  }

  /**
   * `payout.started` must move the bounty to `paying` before anything goes to Bitnob. If the
   * emit throws (bounty on hold, gone, or the save failed), the claim is undone: the row is back
   * to `pending` with the attempt not counted, so `resume()` or the next `/pay` tries again.
   */
  private async gate(row: Payout): Promise<true | Payout> {
    try {
      await this.emit({
        type: "payout.started",
        bountyId: row.bountyId,
        occurredAt: this.now().toISOString(),
        payoutId: row.id,
        attempt: row.attempts,
      });
      return true;
    } catch (err) {
      const reason = `not started, the bounty wasn't moved to paying: ${safe(err)}`;
      this.log.warn(`[payouts] ${row.reference}-${row.attempts} ${reason}`);
      const back = await this.store.update(
        row.id,
        { status: "processing", attempts: row.attempts },
        { status: "pending", attempts: row.attempts - 1, lastError: reason },
      );
      return back ?? (await this.store.get(row.id)) ?? row;
    }
  }

  /**
   * Moves the current attempt forward from wherever it stands.
   * `fresh`: we just claimed and gated it. Otherwise (poll / resume after a crash) the gate is
   * run again if no invoice was saved yet: the crash may have happened before it.
   */
  private async drive(row: Payout, fresh: boolean): Promise<Payout> {
    if (this.inFlight.has(row.id) || !isLightning(row)) return row;
    this.inFlight.add(row.id);
    try {
      if (!row.paymentRequest) {
        if (!fresh) {
          const gated = await this.gate(row);
          if (gated !== true) return gated;
        }
        const prepared = await this.prepare(row);
        if (prepared.status !== "processing" || !prepared.paymentRequest) return prepared;
        row = prepared;
      }
      if (!row.sentAt) {
        // Nothing left for Bitnob in this attempt yet. An invoice that expired meanwhile gets replaced.
        if (row.invoiceExpiresAt && Date.parse(row.invoiceExpiresAt) - 30_000 <= this.now().getTime()) {
          return await this.fail(row, "invoice expired before it was sent");
        }
        return await this.send(row);
      }
      return await this.check(row);
    } finally {
      this.inFlight.delete(row.id);
    }
  }

  /** Rate → sats, LNURL-pay → checked invoice, saved on the row. Nothing is paid here. */
  private async prepare(row: Payout): Promise<Payout> {
    let payee: Payee;
    try {
      payee = await this.getPayee(row.userId);
    } catch (err) {
      return await this.fail(row, `payout account: ${safe(err)}`, err instanceof PayoutConfigError);
    }
    let quote: { sats: number; xofPerBtc: number };
    try {
      quote = await payoutSats(this.rates, row.amountXof);
    } catch (err) {
      return await this.fail(row, `rate: ${safe(err)}`);
    }
    if (quote.sats < 1) return await this.fail(row, `${row.amountXof} FCFA is less than 1 sat`, true);
    let invoice;
    try {
      invoice = await this.resolver.invoiceFor(payee.lightningAddress, quote.sats * 1000);
    } catch (err) {
      // The prefix is what the public status comment keys on (settlement/status-extras.ts).
      const fatal = err instanceof LnurlError ? !err.retryable : false;
      return await this.fail(row, `${fatal ? "lnurl refused" : "lnurl unreachable"}: ${safe(err)}`, fatal);
    }
    const saved = await this.store.update(
      row.id,
      { status: "processing", attempts: row.attempts },
      {
        lightningAddress: payee.lightningAddress,
        amountSats: quote.sats,
        xofPerBtc: quote.xofPerBtc,
        paymentRequest: invoice.bolt11,
        paymentHash: invoice.paymentHash,
        invoiceExpiresAt: invoice.expiresAt,
      },
    );
    return saved ?? (await this.store.get(row.id)) ?? row;
  }

  /** Deterministic from the row: a replay sends exactly the same body as the first request. */
  private payInput(row: Payout) {
    return {
      request: row.paymentRequest!,
      reference: `${row.reference}-${row.attempts}`,
      max_fee: this.maxFeeSats(row.amountSats ?? 0),
      ...(this.customerId ? { customer_id: this.customerId } : {}),
    };
  }

  /** The only call that moves money: `sentAt` is saved first, then exactly one request. */
  private async send(row: Payout): Promise<Payout> {
    const marked = await this.store.update(
      row.id,
      { status: "processing", attempts: row.attempts },
      { sentAt: this.now().toISOString() },
    );
    if (!marked) return (await this.store.get(row.id)) ?? row;
    row = marked;
    const ref = `${row.reference}-${row.attempts}`;
    this.log.info(
      `[payouts] ${ref}: paying ${row.amountSats} sats (${row.amountXof} FCFA at ${Math.round(row.xofPerBtc ?? 0)} FCFA/BTC) to ${maskLightningAddress(row.lightningAddress ?? "")}`,
    );
    let payment: LightningPayment;
    try {
      payment = await this.rails.payLightningInvoice(this.payInput(row), { retries: 0 });
    } catch (err) {
      if (refusedBeforePaying(err)) {
        return await this.fail(row, `pay: ${safe(err)}`, isFatal(err));
      }
      this.log.warn(`[payouts] ${ref}: pay answered ${safe(err)}; outcome unknown, will ask Bitnob`);
      return await this.note(row, `pay: ${safe(err)} (outcome unknown, polling)`);
    }
    return this.apply(row, payment);
  }

  /**
   * The payment was sent; ask Bitnob how it went. By id when we have one; otherwise (the answer
   * was lost) by replaying the same reference + same invoice, which can't create a second payment.
   */
  private async check(row: Payout): Promise<Payout> {
    const ref = `${row.reference}-${row.attempts}`;
    if (row.bitnobPayoutId) {
      try {
        return await this.apply(row, await this.rails.getLightningPayment(row.bitnobPayoutId));
      } catch (err) {
        if (!(err instanceof BitnobError && err.status === 404)) {
          return await this.note(row, `status check: ${safe(err)} (outcome unknown, polling)`);
        }
        // Not readable by id: fall back to the idempotent replay below.
      }
    }
    let payment: LightningPayment;
    try {
      payment = await this.rails.payLightningInvoice(this.payInput(row), { retries: 0 });
    } catch (err) {
      // 400/422 on a replay once the invoice has expired: Bitnob has no payment under this
      // reference and the invoice can no longer be paid by anyone, so the attempt is over.
      // Before expiry a refusal could be "already in flight": keep waiting.
      const expired = row.invoiceExpiresAt && Date.parse(row.invoiceExpiresAt) <= this.now().getTime();
      if (expired && err instanceof BitnobError && (err.status === 400 || err.status === 422)) {
        return await this.fail(row, `Bitnob has no payment ${ref} and its invoice expired: ${safe(err)}`);
      }
      return await this.note(row, `status check: ${safe(err)} (outcome unknown, polling)`);
    }
    return this.apply(row, payment);
  }

  /** Acts on a Bitnob payment answer for the current attempt. */
  private async apply(row: Payout, payment: LightningPayment): Promise<Payout> {
    const id = typeof payment.id === "string" && payment.id ? payment.id : null;
    if (id && id !== row.bitnobPayoutId) {
      const saved = await this.store.update(row.id, { status: "processing", attempts: row.attempts }, { bitnobPayoutId: id });
      if (!saved) return (await this.store.get(row.id)) ?? row;
      row = saved;
    }
    const outcome = toLightningOutcome(payment.status, payment.preimage);
    if (outcome === "success") return this.succeed(row, typeof payment.preimage === "string" ? payment.preimage : null);
    if (outcome === "failed") return this.fail(row, `Bitnob reported ${String(payment.status)}`);
    return this.note(row, `Bitnob: ${String(payment.status ?? "pending")}, polling`);
  }

  /** Records why a `processing` row is waiting, without changing its state. */
  private async note(row: Payout, error: string): Promise<Payout> {
    const updated = await this.store.update(
      row.id,
      { status: "processing", attempts: row.attempts },
      { lastError: maskPhones(error) },
    );
    return updated ?? (await this.store.get(row.id)) ?? row;
  }

  private async succeed(row: Payout, preimage: string | null): Promise<Payout> {
    const done = await this.store.update(
      row.id,
      { status: "processing", attempts: row.attempts },
      { status: "succeeded", paidAt: this.now().toISOString(), lastError: null, preimage },
    );
    if (!done) return (await this.store.get(row.id)) ?? row;
    this.log.info(
      `[payouts] ${row.reference} paid ${row.amountSats} sats (${row.amountXof} FCFA) to ${maskLightningAddress(row.lightningAddress ?? "")} (attempt ${row.attempts})`,
    );
    await this.emit({
      type: "payout.succeeded",
      bountyId: row.bountyId,
      occurredAt: this.now().toISOString(),
      payoutId: row.id,
      bitnobPayoutId: row.bitnobPayoutId ?? `${row.reference}-${row.attempts}`,
    });
    return done;
  }

  /** `fatal`: retrying can't help (bad credentials, feature off, invalid address, amount out of range). */
  private async fail(row: Payout, rawError: string, fatal = false): Promise<Payout> {
    const error = maskPhones(rawError);
    const last = fatal || row.attempts >= this.maxAttempts;
    const updated = await this.store.update(
      row.id,
      { status: "processing", attempts: row.attempts },
      { status: last ? "failed" : "pending", lastError: error },
    );
    if (!updated) return (await this.store.get(row.id)) ?? row;
    this.log.warn(`[payouts] ${row.reference} attempt ${row.attempts}/${this.maxAttempts} failed${fatal ? " (not retryable)" : ""}: ${error}`);
    await this.emit({
      type: "payout.failed",
      bountyId: row.bountyId,
      occurredAt: this.now().toISOString(),
      payoutId: row.id,
      attempt: row.attempts,
      error,
    });
    if (!last) {
      const delay = this.retryDelaysMs[Math.min(row.attempts - 1, this.retryDelaysMs.length - 1)] ?? 0;
      this.schedule(() => {
        void this.attempt(updated).catch((err) => this.log.error(`[payouts] retry failed: ${safe(err)}`));
      }, delay);
    }
    return updated;
  }
}

/**
 * Rows from the mobile money rail (B2, and the demo seed) are never driven here: they have no
 * invoice, and paying them over Lightning would be a different payout than the one recorded.
 */
function isLightning(p: Payout): boolean {
  return p.rail === "lightning";
}

/** Fields of one attempt, cleared when a new attempt is claimed. */
const EMPTY_ATTEMPT = {
  quoteId: null,
  bitnobPayoutId: null,
  lightningAddress: null,
  amountSats: null,
  xofPerBtc: null,
  paymentRequest: null,
  paymentHash: null,
  invoiceExpiresAt: null,
  sentAt: null,
  preimage: null,
} satisfies Partial<Payout>;

/**
 * Bitnob answered and refused the request: nothing was paid. 400/422 (validation, expired
 * invoice, balance), 401/403 (credentials, feature not enabled), 429 (rate limited).
 * 409 (duplicate reference), 404, 5xx and network errors are **not** refusals: maybe paid.
 */
function refusedBeforePaying(err: unknown): boolean {
  return err instanceof BitnobError && [400, 401, 403, 422, 429].includes(err.status);
}

/** 401/403: our credentials or a feature Bitnob hasn't enabled; config errors: ours. A retry won't fix them. */
function isFatal(err: unknown): boolean {
  if (err instanceof PayoutConfigError) return true;
  return err instanceof BitnobError && (err.status === 401 || err.status === 403);
}

function safe(err: unknown): string {
  return maskPhones(err instanceof Error ? err.message : String(err));
}

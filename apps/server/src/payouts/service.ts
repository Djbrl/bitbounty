import { randomUUID } from "node:crypto";
import { BitnobError } from "@bitbounty/bitnob";
import { assertAmount, type InternalEvent, type Payout } from "@bitbounty/core";
import type { GithubDispatcher } from "../github/dispatcher.js";
import { PAYOUT_EVENTS, parseEnvelope, toPayoutOutcome, toPayoutUpdate, type PayoutUpdate } from "../bitnob/events.js";
import { BankCodes, toBitnobBeneficiary, type Beneficiary, type PayoutRails } from "./rails.js";
import type { PayoutStore } from "./store.js";

export interface PayoutServiceOptions {
  rails: PayoutRails;
  store: PayoutStore;
  /** Publishes `payout.started` / `payout.succeeded` / `payout.failed` (pg-boss queue in prod). */
  emit: (event: InternalEvent) => void | Promise<void>;
  /** The developer's verified payout account, read at every attempt (they may fix their number). */
  getBeneficiary: (userId: string) => Promise<Beneficiary>;
  /** Public URL of `POST /webhooks/bitnob`; required by Bitnob's initialize. */
  callbackUrl: string;
  /** What we hold and pay from. */
  fromAsset?: "USDT" | "BTC";
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

/**
 * Pays a bounty to the developer's mobile money: quote → initialize → finalize,
 * up to `maxAttempts` attempts, never twice.
 *
 * Why it can't pay twice:
 * - one row per bounty; a duplicate `start()` finds it and does nothing unless it's `pending`;
 * - every move is a compare-and-set on (status, attempts), so only one worker runs an attempt;
 * - a new attempt (new quote) starts only after the previous one **definitely** failed:
 *   a 4xx from Bitnob, or Bitnob reporting it expired/failed. A timeout or 5xx on finalize
 *   means "maybe paid": the row stays `processing` and polling asks Bitnob what happened;
 * - each attempt has its own Bitnob reference `pay-<bountyId>-<n>`, so redoing the quote
 *   after a crash returns the same quote instead of creating a second payout.
 */
export class PayoutService {
  private readonly rails: PayoutRails;
  private readonly store: PayoutStore;
  private readonly emit: PayoutServiceOptions["emit"];
  private readonly getBeneficiary: PayoutServiceOptions["getBeneficiary"];
  private readonly callbackUrl: string;
  private readonly fromAsset: "USDT" | "BTC";
  private readonly maxAttempts: number;
  private readonly retryDelaysMs: number[];
  private readonly schedule: (fn: () => void, ms: number) => void;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly log: Pick<Console, "info" | "warn" | "error">;
  private readonly banks: BankCodes;
  /** Payout ids being driven in this process, so polling doesn't race an attempt. */
  private readonly inFlight = new Set<string>();

  constructor(opts: PayoutServiceOptions) {
    this.rails = opts.rails;
    this.store = opts.store;
    this.emit = opts.emit;
    this.getBeneficiary = opts.getBeneficiary;
    this.callbackUrl = opts.callbackUrl;
    this.fromAsset = opts.fromAsset ?? "USDT";
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.retryDelaysMs = opts.retryDelaysMs ?? [5_000, 30_000];
    this.schedule = opts.schedule ?? ((fn, ms) => void setTimeout(fn, ms));
    this.now = opts.now ?? (() => new Date());
    this.newId = opts.newId ?? randomUUID;
    this.log = opts.log ?? console;
    this.banks = new BankCodes(this.rails);
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
    });
    if (payout.userId !== req.userId || payout.amountXof !== req.amountXof) {
      throw new Error(`bounty ${req.bountyId} already has a payout to another user or for another amount`);
    }
    if (payout.status !== "pending") return payout;
    return this.attempt(payout);
  }

  /** Applies a webhook or polling result. Returns null when the payout isn't one of ours. */
  async handleUpdate(update: PayoutUpdate): Promise<Payout | null> {
    const row = await this.store.findByBitnob(update);
    if (!row) return null;
    // Duplicates and late events (e.g. `processing` after `success`) land here.
    if (row.status !== "processing") return row;
    if (update.outcome === "success") return this.succeed(row);
    if (update.outcome === "failed") return this.fail(row, `Bitnob reported ${update.rawStatus}`);
    return row;
  }

  /** Asks Bitnob about every payout still `processing` (fallback when webhooks don't arrive). */
  async poll(): Promise<void> {
    for (const row of await this.store.listByStatus("processing")) {
      if (this.inFlight.has(row.id)) continue;
      await this.drive(row, false).catch((err) =>
        this.log.error(`[payouts] poll failed for ${row.reference}: ${message(err)}`),
      );
    }
  }

  /** On boot: finish what a crash interrupted (in-flight attempts and lost retry timers). */
  async resume(): Promise<void> {
    for (const row of await this.store.listByStatus("pending")) {
      if (row.attempts > 0) await this.attempt(row).catch((err) => this.log.error(`[payouts] resume: ${message(err)}`));
    }
    await this.poll();
  }

  startPolling(intervalMs = 15_000): () => void {
    const timer = setInterval(() => void this.poll(), intervalMs);
    return () => clearInterval(timer);
  }

  /** Subscribes to Bitnob's payout webhooks (B5). */
  register(dispatcher: GithubDispatcher): void {
    for (const type of PAYOUT_EVENTS) {
      dispatcher.on(type, async (event) => {
        const env = parseEnvelope(event.payload);
        const update = env && toPayoutUpdate(env);
        if (update) await this.handleUpdate(update);
      });
    }
  }

  private async attempt(p: Payout): Promise<Payout> {
    if (p.attempts >= this.maxAttempts) return p;
    const n = p.attempts + 1;
    const claimed = await this.store.update(
      p.id,
      { status: "pending", attempts: p.attempts },
      { status: "processing", attempts: n, quoteId: null, bitnobPayoutId: null, lastError: null },
    );
    if (!claimed) return (await this.store.get(p.id)) ?? p;
    await this.emit({
      type: "payout.started",
      bountyId: p.bountyId,
      occurredAt: this.now().toISOString(),
      payoutId: p.id,
      attempt: n,
    });
    return this.drive(claimed, true);
  }

  /**
   * Moves the current attempt forward from wherever it stands.
   * `fresh`: we just claimed it, nothing exists at Bitnob yet.
   * Otherwise (poll / resume) we first ask Bitnob what state it's in.
   */
  private async drive(row: Payout, fresh: boolean): Promise<Payout> {
    if (this.inFlight.has(row.id)) return row;
    this.inFlight.add(row.id);
    try {
      const reference = `${row.reference}-${row.attempts}`;

      if (!row.quoteId || !row.bitnobPayoutId) {
        let quote;
        try {
          quote = await this.rails.createPayoutQuote({
            from_asset: this.fromAsset,
            to_currency: "XOF",
            country: (await this.getBeneficiary(row.userId)).country,
            source: "offchain",
            settlement_amount: String(row.amountXof),
            payment_reason: "bounty",
            reference,
          });
        } catch (err) {
          return await this.fail(row, `quote: ${message(err)}`);
        }
        const saved = await this.store.update(
          row.id,
          { status: "processing", attempts: row.attempts },
          { quoteId: quote.quote_id, bitnobPayoutId: quote.id },
        );
        if (!saved) return (await this.store.get(row.id)) ?? row;
        row = saved;
      }

      let stage = "quote";
      if (!fresh) {
        const remote = await this.rails.getPayout(row.bitnobPayoutId!);
        stage = toPayoutOutcome(String(remote.status ?? ""));
        if (stage === "success") return await this.succeed(row);
        if (stage === "failed") return await this.fail(row, `Bitnob reported ${String(remote.status)}`);
        if (stage === "processing") return row;
        if (stage === "quote" && remote.expires_at && Date.parse(remote.expires_at) <= this.now().getTime()) {
          return await this.fail(row, "quote expired before initialize");
        }
      }

      if (stage === "quote") {
        try {
          const ben = await this.getBeneficiary(row.userId);
          const bankCode = await this.banks.resolve(ben.country, ben.provider);
          await this.rails.initializePayout(row.quoteId!, {
            reference,
            beneficiary: toBitnobBeneficiary(ben, bankCode),
            callback_url: this.callbackUrl,
            payment_reason: "bounty",
          });
        } catch (err) {
          // Nothing has been debited before finalize: safe to fail and retry with a new quote.
          return await this.fail(row, `initialize: ${message(err)}`);
        }
      }

      let finalized;
      try {
        finalized = await this.rails.finalizePayout(row.quoteId!);
      } catch (err) {
        if (err instanceof BitnobError && err.status >= 400 && err.status < 500) {
          return await this.fail(row, `finalize: ${message(err)}`);
        }
        // Timeout / network / 5xx: the money may already be on its way. Never retry blind;
        // the row stays `processing` and poll() asks Bitnob for the real outcome.
        this.log.warn(`[payouts] finalize outcome unknown for ${reference}, will poll: ${message(err)}`);
        return row;
      }
      const outcome = finalized?.status ? toPayoutOutcome(String(finalized.status)) : "processing";
      if (outcome === "success") return await this.succeed(row);
      if (outcome === "failed") return await this.fail(row, `Bitnob reported ${String(finalized?.status)}`);
      return row;
    } finally {
      this.inFlight.delete(row.id);
    }
  }

  private async succeed(row: Payout): Promise<Payout> {
    const done = await this.store.update(
      row.id,
      { status: "processing", attempts: row.attempts },
      { status: "succeeded", paidAt: this.now().toISOString() },
    );
    if (!done) return (await this.store.get(row.id)) ?? row;
    this.log.info(`[payouts] ${row.reference} paid ${row.amountXof} FCFA (attempt ${row.attempts})`);
    await this.emit({
      type: "payout.succeeded",
      bountyId: row.bountyId,
      occurredAt: this.now().toISOString(),
      payoutId: row.id,
      bitnobPayoutId: row.bitnobPayoutId ?? "",
    });
    return done;
  }

  private async fail(row: Payout, error: string): Promise<Payout> {
    const last = row.attempts >= this.maxAttempts;
    const updated = await this.store.update(
      row.id,
      { status: "processing", attempts: row.attempts },
      { status: last ? "failed" : "pending", lastError: error },
    );
    if (!updated) return (await this.store.get(row.id)) ?? row;
    this.log.warn(`[payouts] ${row.reference} attempt ${row.attempts}/${this.maxAttempts} failed: ${error}`);
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
        void this.attempt(updated).catch((err) => this.log.error(`[payouts] retry failed: ${message(err)}`));
      }, delay);
    }
    return updated;
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

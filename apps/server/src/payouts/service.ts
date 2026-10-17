import { randomUUID } from "node:crypto";
import { BitnobError } from "@bitbounty/bitnob";
import { assertAmount, type InternalEvent, type Payout } from "@bitbounty/core";
import type { GithubDispatcher } from "../github/dispatcher.js";
import { PAYOUT_EVENTS, parseEnvelope, toPayoutOutcome, toPayoutUpdate, type PayoutUpdate } from "../bitnob/events.js";
import {
  BankCodes,
  PayoutConfigError,
  maskPhones,
  readBankCodeFallback,
  toBitnobBeneficiary,
  type BankCodeFallback,
  type Beneficiary,
  type PayoutRails,
} from "./rails.js";
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
  /** `bank_code`s used when Bitnob's bank directory has none. Defaults to `BITNOB_<CC>_BANK_CODES`. */
  bankCodes?: BankCodeFallback;
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
 * - finalize (the only call that moves money) is sent **once** per attempt: no client-level
 *   retry, and never again from poll/resume once the payout was initialized at Bitnob;
 * - after a finalize error of any kind (timeout, 5xx, 409, 422…) we ask Bitnob
 *   (`GET /api/payouts/:id`) and fail the attempt only if Bitnob says expired/failed or has
 *   no such payout. Anything else means "maybe paid": the row stays `processing`;
 * - a new attempt (new quote) starts only after the previous one **definitely** failed;
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
    this.banks = new BankCodes(this.rails, opts.bankCodes ?? readBankCodeFallback());
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
    // An event for an earlier attempt's Bitnob payout must not touch the current attempt.
    if (update.bitnobPayoutId && row.bitnobPayoutId && update.bitnobPayoutId !== row.bitnobPayoutId) return row;
    if (update.outcome === "success") return this.succeed(row);
    if (update.outcome === "failed") return this.fail(row, `Bitnob reported ${update.rawStatus}`);
    return row;
  }

  /** Asks Bitnob about every payout still `processing` (fallback when webhooks don't arrive). */
  async poll(): Promise<void> {
    for (const row of await this.store.listByStatus("processing")) {
      if (this.inFlight.has(row.id)) continue;
      await this.drive(row, false).catch((err) =>
        this.log.error(`[payouts] poll failed for ${row.reference}: ${safe(err)}`),
      );
    }
  }

  /**
   * On boot: finish what a crash interrupted. Runs every `pending` row, including those that
   * were never claimed (crash between create and the first attempt) and lost retry timers.
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
   * Otherwise (poll / resume) we first ask Bitnob what state it's in, and only initialize +
   * finalize when Bitnob says the payout is still a bare quote (so no finalize ever took).
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
          return await this.fail(row, `quote: ${safe(err)}`, isFatal(err));
        }
        // The developer must receive exactly the bounty: refuse a quote that settles anything else.
        if (Number(quote.settlement_amount) !== row.amountXof) {
          return await this.fail(
            row,
            `quote ${quote.quote_id} settles ${String(quote.settlement_amount)} XOF, expected ${row.amountXof}`,
            true,
          );
        }
        const saved = await this.store.update(
          row.id,
          { status: "processing", attempts: row.attempts },
          { quoteId: quote.quote_id, bitnobPayoutId: quote.id },
        );
        if (!saved) return (await this.store.get(row.id)) ?? row;
        row = saved;
      }

      if (!fresh) {
        const remote = await this.rails.getPayout(row.bitnobPayoutId!);
        const status = String(remote.status ?? "");
        const stage = toPayoutOutcome(status);
        if (stage === "success") return await this.succeed(row);
        if (stage === "failed") return await this.fail(row, `Bitnob reported ${status}`);
        if (stage !== "quote") {
          // INITIATED: a finalize may have been sent before a crash or a lost answer. Re-sending it
          // could pay twice, so we wait for Bitnob to move it (processing → success, or expired).
          if (stage === "initiated" && remote.expires_at && Date.parse(remote.expires_at) <= this.now().getTime()) {
            this.log.warn(`[payouts] ${reference} still ${status} after its quote expired; waiting for Bitnob to expire it`);
          }
          return row;
        }
        if (remote.expires_at && Date.parse(remote.expires_at) <= this.now().getTime()) {
          return await this.fail(row, "quote expired before initialize");
        }
      }

      // Bitnob holds a bare quote: nothing was initialized, so nothing was finalized either.
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
        return await this.fail(row, `initialize: ${safe(err)}`, isFatal(err));
      }

      let finalized;
      try {
        // Exactly one request: a client-level retry of a finalize that went through but timed
        // out comes back "already finalized", which must never be read as "not paid".
        finalized = await this.rails.finalizePayout(row.quoteId!, { retries: 0 });
      } catch (err) {
        return await this.reconcile(row, `finalize: ${safe(err)}`);
      }
      const outcome = finalized?.status ? toPayoutOutcome(String(finalized.status)) : "processing";
      if (outcome === "success") return await this.succeed(row);
      if (outcome === "failed") return await this.fail(row, `Bitnob reported ${String(finalized?.status)}`);
      return row;
    } finally {
      this.inFlight.delete(row.id);
    }
  }

  /**
   * After a finalize error of any kind, the money may be on its way. Only Bitnob knows:
   * the attempt fails only if Bitnob says expired/failed or doesn't know the payout.
   * Otherwise it stays `processing` and poll()/webhooks settle it later.
   */
  private async reconcile(row: Payout, cause: string): Promise<Payout> {
    let remote;
    try {
      remote = await this.rails.getPayout(row.bitnobPayoutId!);
    } catch (err) {
      if (err instanceof BitnobError && err.status === 404) {
        return await this.fail(row, `${cause}; Bitnob has no payout ${row.bitnobPayoutId}`);
      }
      this.log.warn(`[payouts] ${row.reference}-${row.attempts}: ${cause}; status check failed too (${safe(err)}), will poll`);
      return await this.note(row, `${cause} (outcome unknown, polling)`);
    }
    const status = String(remote.status ?? "");
    const outcome = toPayoutOutcome(status);
    if (outcome === "success") return await this.succeed(row);
    if (outcome === "failed") return await this.fail(row, `${cause}; Bitnob reports ${status}`);
    this.log.warn(`[payouts] ${row.reference}-${row.attempts}: ${cause}; Bitnob reports ${status || "no status"}, will poll`);
    return await this.note(row, `${cause} (Bitnob: ${status || "unknown"}, polling)`);
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

  private async succeed(row: Payout): Promise<Payout> {
    const done = await this.store.update(
      row.id,
      { status: "processing", attempts: row.attempts },
      { status: "succeeded", paidAt: this.now().toISOString(), lastError: null },
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

  /** `fatal`: retrying can't help (bad credentials, rejected input, missing config). */
  private async fail(row: Payout, rawError: string, fatal = false): Promise<Payout> {
    const error = maskPhones(rawError);
    const last = fatal || row.attempts >= this.maxAttempts;
    const updated = await this.store.update(
      row.id,
      { status: "processing", attempts: row.attempts },
      { status: last ? "failed" : "pending", lastError: error },
    );
    if (!updated) return (await this.store.get(row.id)) ?? row;
    this.log.warn(
      `[payouts] ${row.reference} attempt ${row.attempts}/${this.maxAttempts} failed${fatal ? " (not retryable)" : ""}: ${error}`,
    );
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

/** 401/403: our credentials; 422: Bitnob rejected the input; config errors: ours. A retry won't fix them. */
function isFatal(err: unknown): boolean {
  if (err instanceof PayoutConfigError) return true;
  return err instanceof BitnobError && (err.status === 401 || err.status === 403 || err.status === 422);
}

function safe(err: unknown): string {
  return maskPhones(err instanceof Error ? err.message : String(err));
}

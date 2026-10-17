/**
 * Normalizes Bitnob webhook bodies. Payout events follow the v2 spec
 * (`{event, event_id, data:{id, quote_id, reference, status, …}}`); deposit
 * events have been seen with a camelCase envelope, so both spellings are read.
 */

type Json = Record<string, unknown>;

export interface BitnobEnvelope {
  /** Unique per event; the dedupe key (`events.external_id`). */
  id: string;
  /** e.g. `payouts.withdrawal.success`, `virtual_account.deposit.success`. */
  type: string;
  data: Json;
}

/** Final or intermediate state of a payout, from a webhook or from polling. */
export type PayoutOutcome = "quote" | "initiated" | "processing" | "success" | "failed";

export interface PayoutUpdate {
  /** Bitnob payout id (also returned when the quote is created). */
  bitnobPayoutId: string | null;
  quoteId: string | null;
  reference: string | null;
  outcome: PayoutOutcome;
  /** Raw status as sent, for the logs. */
  rawStatus: string;
}

export interface DepositUpdate {
  virtualAccountId: string | null;
  reference: string | null;
  /** Integer in the currency's smallest unit (kobo for NGN), null if unreadable. */
  amountMinor: number | null;
  currency: string | null;
}

export const PAYOUT_EVENTS = [
  "payouts.initialized",
  "payouts.processing",
  "payouts.withdrawal.success",
  "payouts.withdrawal.expired",
] as const;

export const DEPOSIT_EVENTS = ["virtual_account.deposit.success", "deposit.success"] as const;

/** Reads the envelope; null when the body has no event id or no event name. */
export function parseEnvelope(body: unknown): BitnobEnvelope | null {
  if (!isObject(body)) return null;
  const id = str(body.event_id) ?? str(body.eventId) ?? str(body.id);
  const type = str(body.event) ?? str(body.eventType) ?? str(body.type);
  if (!id || !type) return null;
  return { id, type, data: isObject(body.data) ? body.data : {} };
}

/** Maps any Bitnob payout status (lower or upper case, webhook or GET) to our outcome. */
export function toPayoutOutcome(status: string): PayoutOutcome {
  switch (status.trim().toLowerCase()) {
    case "success":
    case "successful":
    case "succeeded":
    case "completed":
      return "success";
    case "expired":
    case "failed":
    case "cancelled":
    case "canceled":
    case "rejected":
    case "reversed":
      return "failed";
    case "quote":
      return "quote";
    case "initiated":
    case "initialized":
      return "initiated";
    default:
      return "processing";
  }
}

export function toPayoutUpdate(env: BitnobEnvelope): PayoutUpdate | null {
  if (!env.type.startsWith("payouts.")) return null;
  const d = env.data;
  const rawStatus =
    str(d.status) ??
    (env.type.endsWith(".success") ? "success" : env.type.endsWith(".expired") ? "expired" : "processing");
  return {
    bitnobPayoutId: str(d.id),
    quoteId: str(d.quote_id) ?? str(d.quoteId),
    reference: str(d.reference),
    outcome: toPayoutOutcome(rawStatus),
    rawStatus,
  };
}

export function toDepositUpdate(env: BitnobEnvelope): DepositUpdate | null {
  if (!(DEPOSIT_EVENTS as readonly string[]).includes(env.type)) return null;
  const d = env.data;
  const amount = str(d.amount) ?? (typeof d.amount === "number" ? String(d.amount) : null);
  return {
    virtualAccountId: str(d.virtual_account_id) ?? str(d.virtualAccountId),
    reference: str(d.reference),
    amountMinor: amount && /^\d+$/.test(amount) ? Number(amount) : null,
    currency: str(d.currency),
  };
}

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

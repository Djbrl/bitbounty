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
  /**
   * `ngn_virtual_account`: `virtual_account.deposit.success`, naira into a dedicated NGN account (B4).
   * `stablecoin`: `deposit.success`, USDT/USDC to a deposit address. Never naira.
   */
  kind: "ngn_virtual_account" | "stablecoin";
  virtualAccountId: string | null;
  reference: string | null;
  /**
   * Integer in the currency's smallest unit (kobo for NGN, 1e-6 for USDT/USDC), parsed from
   * Bitnob's major-unit decimal (`"1000.50"` NGN → 100050). Null if unreadable or the currency is unknown.
   */
  amountMinor: number | null;
  currency: string | null;
}

export const PAYOUT_EVENTS = [
  "payouts.initialized",
  "payouts.processing",
  "payouts.withdrawal.success",
  "payouts.withdrawal.expired",
] as const;

/** Naira into a dedicated NGN virtual account. */
export const NGN_DEPOSIT_EVENTS = ["virtual_account.deposit.success"] as const;
/** Stablecoin (USDT/USDC) into a deposit address. Not naira. */
export const STABLECOIN_DEPOSIT_EVENTS = ["deposit.success"] as const;
export const DEPOSIT_EVENTS = [...NGN_DEPOSIT_EVENTS, ...STABLECOIN_DEPOSIT_EVENTS] as const;

/** Decimal places of each currency's smallest unit. Unknown currency → amounts are not parsed. */
export const CURRENCY_DECIMALS: Readonly<Record<string, number>> = {
  NGN: 2,
  GHS: 2,
  KES: 2,
  UGX: 0,
  XOF: 0,
  XAF: 0,
  USD: 2,
  USDT: 6,
  USDC: 6,
  BTC: 8,
  SATS: 0,
};

/**
 * Parses a major-unit amount (`"1000.50"`, `"1,000.50"`, `1000.5`) into an integer of minor units
 * for `currency`, without floating-point math. Null when the currency is unknown, the value isn't a
 * plain non-negative decimal, it has more decimals than the currency allows, or it overflows.
 */
export function toMinorUnits(amount: unknown, currency: string | null | undefined): number | null {
  const decimals = currency ? CURRENCY_DECIMALS[currency.trim().toUpperCase()] : undefined;
  if (decimals === undefined) return null;
  let text: string;
  if (typeof amount === "number") {
    if (!Number.isFinite(amount) || amount < 0) return null;
    text = String(amount);
  } else if (typeof amount === "string") {
    text = amount.trim().replace(/,/g, "");
  } else {
    return null;
  }
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) return null;
  const whole = m[1]!;
  const frac = (m[2] ?? "").replace(/0+$/, "");
  if (frac.length > decimals) return null;
  const minor = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}

/** Reads the envelope; null when the body has no event id or no event name. */
export function parseEnvelope(body: unknown): BitnobEnvelope | null {
  if (!isObject(body)) return null;
  const type = str(body.event) ?? str(body.eventType) ?? str(body.type);
  if (!type) return null;
  // A bare top-level `id` may be the resource id, shared by every event about that payout/deposit,
  // so it is namespaced with the event name and can't collide with a real event_id or another event type.
  const bareId = str(body.id);
  const id = str(body.event_id) ?? str(body.eventId) ?? (bareId ? `${type}#${bareId}` : null);
  if (!id) return null;
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
  const rawStatus = str(d.status) ?? statusFromEventType(env.type);
  return {
    bitnobPayoutId: str(d.id),
    quoteId: str(d.quote_id) ?? str(d.quoteId),
    reference: str(d.reference),
    outcome: toPayoutOutcome(rawStatus),
    rawStatus,
  };
}

/** Status implied by the event name when `data.status` is missing. */
function statusFromEventType(type: string): string {
  if (type.endsWith(".success")) return "success";
  if (type.endsWith(".expired")) return "expired";
  if (type === "payouts.initialized") return "initialized";
  return "processing";
}

export function toDepositUpdate(env: BitnobEnvelope): DepositUpdate | null {
  const d = env.data;
  if ((NGN_DEPOSIT_EVENTS as readonly string[]).includes(env.type)) {
    const currency = (str(d.currency) ?? "NGN").toUpperCase();
    return {
      kind: "ngn_virtual_account",
      virtualAccountId: str(d.virtual_account_id) ?? str(d.virtualAccountId),
      reference: str(d.reference),
      amountMinor: toMinorUnits(d.amount, currency),
      currency,
    };
  }
  if ((STABLECOIN_DEPOSIT_EVENTS as readonly string[]).includes(env.type)) {
    // No NGN default here: a stablecoin deposit names its asset, or the amount stays unparsed.
    const currency = (str(d.currency) ?? str(d.asset) ?? str(d.coin))?.toUpperCase() ?? null;
    return {
      kind: "stablecoin",
      virtualAccountId: null,
      reference: str(d.reference),
      amountMinor: toMinorUnits(d.amount, currency),
      currency,
    };
  }
  return null;
}

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

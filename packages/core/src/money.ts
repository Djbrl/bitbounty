/**
 * Money is always an integer count of the smallest unit we handle:
 * FCFA (XOF has no minor unit), satoshis, kobo, or USDT base units (1 USDT = 1_000_000).
 * Never a float. Every amount that enters the core goes through `assertAmount`.
 */

/** Whole FCFA. The amount the developer receives. */
export type Xof = number;
/** Satoshis. */
export type Sats = number;
/** Kobo (1 naira = 100 kobo). */
export type Kobo = number;
/** USDT base units (1 USDT = 1_000_000). */
export type UsdtUnits = number;

export type Currency = "XOF" | "BTC" | "USDT" | "NGN";

export class InvalidAmountError extends Error {
  constructor(
    readonly field: string,
    readonly value: unknown,
  ) {
    super(`${field} must be a positive integer, got ${String(value)}`);
    this.name = "InvalidAmountError";
  }
}

/** True for a positive safe integer (no floats, no NaN, no Infinity, no zero, no negatives). */
export function isAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Throws `InvalidAmountError` unless `value` is a positive safe integer. */
export function assertAmount(value: unknown, field = "amount"): asserts value is number {
  if (!isAmount(value)) throw new InvalidAmountError(field, value);
}

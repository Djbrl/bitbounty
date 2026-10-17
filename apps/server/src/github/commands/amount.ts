/**
 * Parse a `/bounty` amount. Amounts are always whole FCFA (XOF has no minor unit).
 *
 * Accepted: `10000`, `10 000` (space, nbsp or narrow nbsp), `10,000`, `10k`, `1.5k`, `2m`,
 * with an optional `FCFA` / `CFA` / `F` / `XOF` suffix (any case, glued or spaced),
 * and an optional leading `+` (top-up on an already funded issue).
 * Rejected: 0, negatives, decimals (`10000.5`, `10,5`), `10.000` (ambiguous), other currencies,
 * scientific notation, anything outside [min, max].
 */

export const DEFAULT_MIN_AMOUNT_XOF = 100;
export const DEFAULT_MAX_AMOUNT_XOF = 10_000_000;

export type AmountError =
  | "missing"
  | "invalid"
  | "negative"
  | "zero"
  | "decimal"
  | "ambiguous"
  | "currency"
  | "too_small"
  | "too_large";

export type AmountResult =
  | { ok: true; amountXof: number; topUp: boolean }
  | { ok: false; error: AmountError; message: string };

export interface AmountLimits {
  min?: number;
  max?: number;
}

const fmt = (n: number) => n.toLocaleString("en-US").replace(/,/g, " ");

const FOREIGN_CURRENCY = /(\$|€|£|₦|\b(usd|eur|gbp|ngn|naira|sats?|btc|usdt|dollars?|euros?)\b)/i;
const XOF_SUFFIX = /\s*(fcfa|cfa|xof|f)\.?$/i;

export function parseAmount(raw: string, limits: AmountLimits = {}): AmountResult {
  const min = limits.min ?? DEFAULT_MIN_AMOUNT_XOF;
  const max = limits.max ?? DEFAULT_MAX_AMOUNT_XOF;
  const fail = (error: AmountError, message: string): AmountResult => ({ ok: false, error, message });
  const usage = "Use a whole amount in FCFA, e.g. `/bounty 10000`.";

  // Normalise every Unicode space (nbsp, narrow nbsp, thin space…) to a plain space.
  let s = raw.replace(/\s+/g, " ").trim();
  if (s === "") return fail("missing", `Missing amount. ${usage}`);

  if (FOREIGN_CURRENCY.test(s)) {
    return fail("currency", `Bounties are always in FCFA (what the developer receives). ${usage}`);
  }
  s = s.replace(XOF_SUFFIX, "").trim();

  let topUp = false;
  if (s.startsWith("-") || s.startsWith("−")) {
    return fail("negative", `The amount can't be negative. ${usage}`);
  }
  if (s.startsWith("+")) {
    topUp = true;
    s = s.slice(1).trim();
  }

  // Multiplier suffix: k = thousand, m = million.
  let multiplier = 1;
  const suffix = /^(.*?)\s*([km])$/i.exec(s);
  if (suffix) {
    s = suffix[1] ?? "";
    multiplier = suffix[2]!.toLowerCase() === "k" ? 1_000 : 1_000_000;
  }

  let value: number;
  if (/^\d{1,3}([ ,]\d{3})+$/.test(s)) {
    // Grouped thousands: "10 000", "10,000", "1 000 000". Groups must be exactly 3 digits.
    value = Number(s.replace(/[ ,]/g, ""));
  } else if (/^\d+$/.test(s)) {
    value = Number(s);
  } else if (/^\d+[.,]\d+$/.test(s)) {
    if (multiplier === 1) {
      if (/^\d{1,3}\.\d{3}$/.test(s)) {
        return fail("ambiguous", `\`${raw.trim()}\` is ambiguous. Write it without a dot, e.g. \`/bounty 10000\`.`);
      }
      return fail("decimal", `FCFA has no cents, so the amount must be a whole number. ${usage}`);
    }
    // "1.5k" or "1,5k" → 1500. Only allowed if the result is whole.
    value = Number(s.replace(",", "."));
  } else {
    return fail("invalid", `\`${raw.trim()}\` is not an amount. ${usage}`);
  }

  // Integer maths for k/m with decimals, to dodge float error (1.1k must be 1100, not 1100.0000000000002).
  const total = Math.round(value * multiplier * 1000) / 1000;
  if (!Number.isFinite(total)) return fail("invalid", `\`${raw.trim()}\` is not an amount. ${usage}`);
  if (!Number.isInteger(total)) {
    return fail("decimal", `FCFA has no cents, so the amount must be a whole number. ${usage}`);
  }
  if (total === 0) return fail("zero", `The amount must be more than 0. ${usage}`);
  if (!Number.isSafeInteger(total) || total > max) {
    return fail("too_large", `The maximum bounty is ${fmt(max)} FCFA.`);
  }
  if (total < min) return fail("too_small", `The minimum bounty is ${fmt(min)} FCFA.`);
  return { ok: true, amountXof: total, topUp };
}

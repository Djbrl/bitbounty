/** Price bounds for one bounty, in whole FCFA. Anything outside is clamped, never trusted. */
export const MIN_PRICE_XOF = 2_500;
export const MAX_PRICE_XOF = 100_000;
/** Prices are shown rounded: 12 345 → 12 500. */
export const PRICE_STEP_XOF = 500;

/** Clamp and round a model-suggested price. Non-numbers fall back to the minimum. */
export function normalizePrice(raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? raw : MIN_PRICE_XOF;
  const rounded = Math.round(n / PRICE_STEP_XOF) * PRICE_STEP_XOF;
  return Math.min(MAX_PRICE_XOF, Math.max(MIN_PRICE_XOF, rounded));
}

/** Default claim length: 72 hours. */
export const DEFAULT_CLAIM_TTL_MS = 72 * 60 * 60 * 1000;

/** `CLAIM_TTL_MINUTES` (the demo uses 5) or 72 h. Invalid or non-positive values fall back to 72 h. */
export function readClaimTtlMs(env: { CLAIM_TTL_MINUTES?: string } = process.env): number {
  const raw = env.CLAIM_TTL_MINUTES?.trim();
  if (!raw) return DEFAULT_CLAIM_TTL_MS;
  const minutes = Number(raw);
  return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60_000) : DEFAULT_CLAIM_TTL_MS;
}

/** Sweep often enough for short demo TTLs, at most once a minute. */
export function sweepIntervalMs(ttlMs: number): number {
  return Math.min(60_000, Math.max(1_000, Math.floor(ttlMs / 6)));
}

import { createHmac, timingSafeEqual } from "node:crypto";

/** Computes the `x-bitnob-signature` Bitnob would send: hex HMAC-SHA512 of the raw body. */
export function signBitnobPayload(secret: string, body: string | Buffer): string {
  return createHmac("sha512", secret).update(body).digest("hex");
}

/**
 * Verifies Bitnob's `x-bitnob-signature` header against the raw request body.
 * Constant-time compare; returns false on any malformed or missing input.
 * Tolerates an optional `sha512=` prefix.
 */
export function verifyBitnobSignature(
  secret: string,
  body: string | Buffer,
  header: string | undefined | null,
): boolean {
  if (!secret || !header) return false;
  const received = header.trim().replace(/^sha512=/i, "");
  if (!/^[0-9a-f]{128}$/i.test(received)) return false;
  const expected = createHmac("sha512", secret).update(body).digest();
  const actual = Buffer.from(received, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

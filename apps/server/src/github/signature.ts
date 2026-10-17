import { createHmac, timingSafeEqual } from "node:crypto";

const PREFIX = "sha256=";

/** Computes the `X-Hub-Signature-256` header value GitHub would send for this body. */
export function signPayload(secret: string, body: string | Buffer): string {
  return PREFIX + createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Verifies GitHub's `X-Hub-Signature-256` header against the raw request body.
 * Constant-time compare; returns false on any malformed or missing input.
 */
export function verifySignature(
  secret: string,
  body: string | Buffer,
  header: string | undefined | null,
): boolean {
  if (!secret || !header || !header.startsWith(PREFIX)) return false;
  const received = header.slice(PREFIX.length);
  if (!/^[0-9a-f]{64}$/i.test(received)) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  const actual = Buffer.from(received, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

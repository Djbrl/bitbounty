import { createHmac, randomBytes } from "node:crypto";

export interface AuthHeaders {
  "x-auth-client": string;
  "x-auth-timestamp": string;
  "x-auth-nonce": string;
  "x-auth-signature": string;
}

/** 16 random bytes as hex. A fresh one is needed for every request, retries included. */
export function newNonce(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Bitnob request signature: hex HMAC-SHA256 of `CLIENT_ID:TIMESTAMP:NONCE:BODY`,
 * keyed with the client secret. TIMESTAMP is Unix seconds; BODY is the exact
 * (compact JSON) string sent, or "" when there is no body.
 */
export function signature(
  clientId: string,
  clientSecret: string,
  timestamp: string,
  nonce: string,
  body: string,
): string {
  return createHmac("sha256", clientSecret)
    .update(`${clientId}:${timestamp}:${nonce}:${body}`)
    .digest("hex");
}

export function authHeaders(
  clientId: string,
  clientSecret: string,
  body: string,
  now: Date = new Date(),
  nonce: string = newNonce(),
): AuthHeaders {
  const timestamp = String(Math.floor(now.getTime() / 1000));
  return {
    "x-auth-client": clientId,
    "x-auth-timestamp": timestamp,
    "x-auth-nonce": nonce,
    "x-auth-signature": signature(clientId, clientSecret, timestamp, nonce, body),
  };
}

/**
 * Lightning Address (LUD-16): `user@domain`, e.g. `awa@blink.sv`. Payouts (B6) resolve it
 * through LNURL-pay at `https://<domain>/.well-known/lnurlp/<user>`.
 */
export interface LightningAddress {
  /** Lower case, as LUD-16 requires: `a-z0-9-_.+`. */
  user: string;
  /** Lower case host name, optionally with a port (`localhost:8787`, for local tests only). */
  domain: string;
}

const USER = /^[a-z0-9\-_.+]{1,64}$/;
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1)$/;

/**
 * Parses and normalizes a Lightning Address. Returns null when it isn't one.
 * `allowLocal` also accepts `localhost` / `127.0.0.1` with a port (tests and the sandbox proof).
 */
export function parseLightningAddress(value: unknown, opts: { allowLocal?: boolean } = {}): LightningAddress | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  const at = v.lastIndexOf("@");
  if (at <= 0 || at !== v.indexOf("@")) return null;
  const user = v.slice(0, at);
  const domain = v.slice(at + 1);
  if (!USER.test(user)) return null;
  if (HOST.test(domain)) return { user, domain };
  if (opts.allowLocal) {
    const m = /^([^:]+)(?::(\d{1,5}))?$/.exec(domain);
    if (m && LOCAL_HOST.test(m[1]!) && (!m[2] || Number(m[2]) <= 65535)) return { user, domain };
  }
  return null;
}

export function isLightningAddress(value: unknown): value is string {
  return parseLightningAddress(value) !== null;
}

/** `awa.diop@blink.sv` → `aw***@blink.sv`: enough to recognise it in logs, not to copy it. */
export function maskLightningAddress(value: string): string {
  const at = value.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${value.slice(0, Math.min(2, at))}***${value.slice(at)}`;
}

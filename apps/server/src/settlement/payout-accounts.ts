import { parseLightningAddress, type PayoutProvider } from "@bitbounty/core";
import { PayoutConfigError, type Beneficiary } from "../payouts/rails.js";
import type { Payee } from "../payouts/service.js";

const PROVIDERS: readonly PayoutProvider[] = ["wave", "orange", "free"];

/** One `PAYOUT_ACCOUNTS` entry: a Lightning Address (B6), and/or the legacy mobile money account. */
export interface EnvPayoutAccount {
  lightningAddress: string | null;
  /** Legacy (B2/B3). Still validated so a typo fails at boot, no longer used to pay. */
  mobile: Beneficiary | null;
}

/**
 * Where to pay each developer, by GitHub login, until payout accounts come from the database
 * (W4 onboarding + B7). Read from `PAYOUT_ACCOUNTS`, one entry per login:
 *   PAYOUT_ACCOUNTS='{"awa-dev":"awa@blink.sv"}'
 *   PAYOUT_ACCOUNTS='{"awa-dev":{"lightningAddress":"awa@blink.sv"}}'
 * The legacy mobile money shape (`{"provider","phone","name","country"}`) is still accepted next
 * to it. Invalid entries throw at boot, so a typo never sends money elsewhere.
 * `allowLocal` accepts `user@127.0.0.1:port` addresses (local LNURL test server only).
 */
export function readPayoutAccounts(
  env: NodeJS.ProcessEnv = process.env,
  opts: { allowLocal?: boolean } = {},
): Map<string, EnvPayoutAccount> {
  const out = new Map<string, EnvPayoutAccount>();
  const raw = env.PAYOUT_ACCOUNTS?.trim();
  if (!raw) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("PAYOUT_ACCOUNTS is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error('PAYOUT_ACCOUNTS must be an object: {"<github login>": "<lightning address>"}');
  }
  for (const [login, v] of Object.entries(parsed)) {
    const a = (typeof v === "string" ? { lightningAddress: v } : (v ?? {})) as Record<string, unknown>;
    let lightningAddress: string | null = null;
    if (a.lightningAddress !== undefined) {
      const addr = parseLightningAddress(a.lightningAddress, opts);
      if (!addr) throw new Error(`PAYOUT_ACCOUNTS.${login}: lightningAddress must look like user@domain (e.g. awa@blink.sv)`);
      lightningAddress = `${addr.user}@${addr.domain}`;
    }
    let mobile: Beneficiary | null = null;
    if (a.provider !== undefined || a.phone !== undefined || a.name !== undefined) {
      const provider = a.provider as PayoutProvider;
      const phone = typeof a.phone === "string" ? a.phone.trim() : "";
      const name = typeof a.name === "string" ? a.name.trim() : "";
      if (!PROVIDERS.includes(provider)) throw new Error(`PAYOUT_ACCOUNTS.${login}: provider must be ${PROVIDERS.join(", ")}`);
      if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error(`PAYOUT_ACCOUNTS.${login}: phone must be E.164, e.g. +221771234567`);
      if (!name) throw new Error(`PAYOUT_ACCOUNTS.${login}: name is required (the name on the mobile money account)`);
      const country = typeof a.country === "string" && /^[A-Za-z]{2}$/.test(a.country) ? a.country.toUpperCase() : "SN";
      mobile = { provider, phoneE164: phone, accountName: name, country };
    }
    if (!lightningAddress && !mobile) throw new Error(`PAYOUT_ACCOUNTS.${login}: give a lightningAddress (e.g. "awa@blink.sv")`);
    out.set(login.toLowerCase(), { lightningAddress, mobile });
  }
  return out;
}

/**
 * `getPayee` for the payout service: claim user ids are `github:<login>`. No entry, or no
 * Lightning Address, is a config error (`PayoutConfigError`): the payout fails at once instead of
 * retrying what only a human can fix.
 */
export function payeeFromAccounts(accounts: Map<string, EnvPayoutAccount>) {
  return async (userId: string): Promise<Payee> => {
    const login = userId.replace(/^github:/, "").toLowerCase();
    const a = accounts.get(login);
    if (!a) throw new PayoutConfigError(`no payout account for @${login} (set it in PAYOUT_ACCOUNTS until W4 onboarding is wired)`);
    if (!a.lightningAddress) {
      throw new PayoutConfigError(`@${login} has no Lightning Address (mobile money payouts are gone: add "lightningAddress" in PAYOUT_ACCOUNTS)`);
    }
    return { lightningAddress: a.lightningAddress };
  };
}

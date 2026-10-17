import type { PayoutProvider } from "@bitbounty/core";
import type { Beneficiary } from "../payouts/rails.js";

const PROVIDERS: readonly PayoutProvider[] = ["wave", "orange", "free"];

/**
 * Where to pay each developer, by GitHub login, until verified payout accounts come from the
 * database (W4 onboarding + B3). Read from `PAYOUT_ACCOUNTS`:
 *   PAYOUT_ACCOUNTS='{"awa-dev":{"provider":"wave","phone":"+221771234567","name":"Awa Diop"}}'
 * `country` defaults to SN. Invalid entries throw at boot, so a typo never sends money elsewhere.
 */
export function readPayoutAccounts(env: NodeJS.ProcessEnv = process.env): Map<string, Beneficiary> {
  const out = new Map<string, Beneficiary>();
  const raw = env.PAYOUT_ACCOUNTS?.trim();
  if (!raw) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("PAYOUT_ACCOUNTS is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error('PAYOUT_ACCOUNTS must be an object: {"<github login>": {"provider", "phone", "name"}}');
  }
  for (const [login, v] of Object.entries(parsed)) {
    const a = (v ?? {}) as Record<string, unknown>;
    const provider = a.provider as PayoutProvider;
    const phone = typeof a.phone === "string" ? a.phone.trim() : "";
    const name = typeof a.name === "string" ? a.name.trim() : "";
    if (!PROVIDERS.includes(provider)) throw new Error(`PAYOUT_ACCOUNTS.${login}: provider must be ${PROVIDERS.join(", ")}`);
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error(`PAYOUT_ACCOUNTS.${login}: phone must be E.164, e.g. +221771234567`);
    if (!name) throw new Error(`PAYOUT_ACCOUNTS.${login}: name is required (the name on the mobile money account)`);
    const country = typeof a.country === "string" && /^[A-Za-z]{2}$/.test(a.country) ? a.country.toUpperCase() : "SN";
    out.set(login.toLowerCase(), { provider, phoneE164: phone, accountName: name, country });
  }
  return out;
}

/** `getBeneficiary` for B2: claim user ids are `github:<login>`. */
export function beneficiaryFromAccounts(accounts: Map<string, Beneficiary>) {
  return async (userId: string): Promise<Beneficiary> => {
    const login = userId.replace(/^github:/, "").toLowerCase();
    const b = accounts.get(login);
    if (!b) throw new Error(`no payout account for @${login} (set it in PAYOUT_ACCOUNTS until W4 onboarding is wired)`);
    return b;
  };
}

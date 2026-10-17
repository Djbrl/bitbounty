import type { Bank, BitnobClient, PayoutBeneficiary } from "@bitbounty/bitnob";
import type { PayoutProvider } from "@bitbounty/core";

/** The Bitnob calls a payout needs. `BitnobClient` satisfies it; tests pass a fake. */
export type PayoutRails = Pick<
  BitnobClient,
  "createPayoutQuote" | "initializePayout" | "finalizePayout" | "getPayout" | "getBanks"
>;

/** Where the money goes, read from the developer's verified payout account. */
export interface Beneficiary {
  provider: PayoutProvider;
  /** E.164, e.g. "+221771234567". */
  phoneE164: string;
  accountName: string;
  /** ISO 3166-1 alpha-2, e.g. "SN". */
  country: string;
}

const PROVIDER_NAMES: Record<PayoutProvider, RegExp> = {
  wave: /wave/i,
  orange: /orange/i,
  free: /free/i,
};

const PROVIDERS = Object.keys(PROVIDER_NAMES) as PayoutProvider[];

/** Fallback `bank_code`s per country (upper case) and provider, from `BITNOB_<CC>_BANK_CODES`. */
export type BankCodeFallback = Record<string, Partial<Record<PayoutProvider, string>>>;

/**
 * The payout can't run because of our configuration or input, not Bitnob's state:
 * retrying a few seconds later can't help, so the attempt fails for good.
 */
export class PayoutConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayoutConfigError";
  }
}

/**
 * Reads `BITNOB_<CC>_BANK_CODES` env vars, e.g. `BITNOB_SN_BANK_CODES='{"wave":"…","orange":"…"}'`.
 * Used when Bitnob's bank directory has no entry for the provider (the sandbox answers
 * `{"banks":null}` for SN). The real codes must be confirmed with Bitnob: there are no defaults.
 */
export function readBankCodeFallback(env: NodeJS.ProcessEnv = process.env): BankCodeFallback {
  const out: BankCodeFallback = {};
  for (const [name, raw] of Object.entries(env)) {
    const m = /^BITNOB_([A-Z]{2})_BANK_CODES$/.exec(name);
    if (!m || !raw?.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new PayoutConfigError(`${name} is not valid JSON (expected {"wave":"<code>","orange":"<code>"})`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new PayoutConfigError(`${name} must be a JSON object like {"wave":"<code>","orange":"<code>"}`);
    }
    const codes: Partial<Record<PayoutProvider, string>> = {};
    for (const [provider, code] of Object.entries(parsed)) {
      if (!PROVIDERS.includes(provider as PayoutProvider)) {
        throw new PayoutConfigError(`${name}: unknown provider "${provider}" (expected ${PROVIDERS.join(", ")})`);
      }
      if (typeof code === "string" && code.trim()) codes[provider as PayoutProvider] = code.trim();
    }
    out[m[1]!] = codes;
  }
  return out;
}

/**
 * Looks up Bitnob's `bank_code` for a mobile money provider: Bitnob's directory first
 * (`GET /api/payouts/banks/:country`, cached per country, but only when it lists something),
 * then the configured fallback.
 */
export class BankCodes {
  private cache = new Map<string, Bank[]>();

  constructor(
    private rails: Pick<PayoutRails, "getBanks">,
    private fallback: BankCodeFallback = {},
  ) {}

  async resolve(country: string, provider: PayoutProvider): Promise<string> {
    const key = country.toUpperCase();
    const banks = await this.directory(key);
    const match = banks.find((b) => typeof b?.bank_name === "string" && PROVIDER_NAMES[provider].test(b.bank_name));
    if (match?.bank_code) return match.bank_code;
    const configured = this.fallback[key]?.[provider];
    if (configured) return configured;
    throw new PayoutConfigError(
      `no Bitnob bank_code for ${provider} in ${key}: Bitnob's bank list ${banks.length ? "has no such rail" : "is empty"} ` +
        `and BITNOB_${key}_BANK_CODES has no "${provider}" entry (get the code from Bitnob, see docs/bitnob-api.md)`,
    );
  }

  private async directory(key: string): Promise<Bank[]> {
    const cached = this.cache.get(key);
    if (cached) return cached;
    // The sandbox answers `{"banks":null}` for SN. Never cache an empty answer: Bitnob may fill it later.
    const banks: unknown = await this.rails.getBanks(key);
    const list = Array.isArray(banks) ? (banks as Bank[]) : [];
    if (list.length) this.cache.set(key, list);
    return list;
  }
}

export function toBitnobBeneficiary(b: Beneficiary, bankCode: string): PayoutBeneficiary {
  const digits = b.phoneE164.replace(/^\+/, "");
  if (!/^[1-9]\d{7,14}$/.test(digits)) throw new Error(`invalid phone number ${maskPhone(b.phoneE164)}`);
  return {
    destination_type: "mobile_money",
    country: b.country.toUpperCase(),
    account_name: b.accountName,
    account_number: digits,
    bank_code: bankCode,
  };
}

/** "+221771234567" → "+2217*******67". Keeps logs and events free of the developer's number. */
export function maskPhone(phone: string): string {
  const m = /^(\+?)(\d*)$/.exec(phone.trim());
  if (!m) return "***";
  const d = m[2]!;
  if (d.length <= 6) return `${m[1]}${"*".repeat(d.length)}`;
  return `${m[1]}${d.slice(0, 4)}${"*".repeat(d.length - 6)}${d.slice(-2)}`;
}

/** Masks anything that looks like a phone number (8 to 15 digits, optional +) in a free-form message. */
export function maskPhones(text: string): string {
  return text.replace(/\+?\d{8,15}/g, (n) => maskPhone(n));
}

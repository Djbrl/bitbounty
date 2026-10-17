import type { BitnobClient, PayoutBeneficiary } from "@bitbounty/bitnob";
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

/** Looks up Bitnob's `bank_code` for a mobile money provider, cached per country. */
export class BankCodes {
  private cache = new Map<string, Promise<{ bank_name: string; bank_code: string }[]>>();

  constructor(private rails: Pick<PayoutRails, "getBanks">) {}

  async resolve(country: string, provider: PayoutProvider): Promise<string> {
    const key = country.toUpperCase();
    let banks = this.cache.get(key);
    if (!banks) {
      banks = this.rails.getBanks(key);
      this.cache.set(key, banks);
      banks.catch(() => this.cache.delete(key));
    }
    const match = (await banks).find((b) => PROVIDER_NAMES[provider].test(b.bank_name));
    if (!match) throw new Error(`Bitnob has no ${provider} payout rail for ${key}`);
    return match.bank_code;
  }
}

export function toBitnobBeneficiary(b: Beneficiary, bankCode: string): PayoutBeneficiary {
  const digits = b.phoneE164.replace(/^\+/, "");
  if (!/^[1-9]\d{7,14}$/.test(digits)) throw new Error(`invalid phone number ${b.phoneE164}`);
  return {
    destination_type: "mobile_money",
    country: b.country.toUpperCase(),
    account_name: b.accountName,
    account_number: digits,
    bank_code: bankCode,
  };
}

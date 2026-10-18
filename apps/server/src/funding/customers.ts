import type { BitnobClient, CreateCustomerInput } from "@bitbounty/bitnob";

/**
 * Bitnob requires a customer for Lightning invoices and naira accounts.
 * One Bitnob customer per funder, created on first use and remembered.
 */
export interface FunderCustomers {
  /** `identity` is needed for naira accounts (KYC fields); Lightning only needs the email. */
  customerId(funderId: string, identity?: Partial<CreateCustomerInput>): Promise<string>;
}

/** Funder ids look like `github:Djbrl`; Bitnob refuses a `:` in an email ("Email must be a valid email address"). */
export function safePart(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, "-");
}

export class BitnobFunderCustomers implements FunderCustomers {
  private ids = new Map<string, Promise<string>>();
  /** B4: funders with a KYC'd customer (naira accounts need one; a Lightning-only customer has just an email). */
  private kycIds = new Map<string, Promise<string>>();

  constructor(
    private client: Pick<BitnobClient, "createCustomer">,
    /** Placeholder emails until funders sign in with a real one (W9). */
    private emailFor: (funderId: string) => string = (id) => `funder-${safePart(id)}@bitbounty.invalid`,
  ) {}

  customerId(funderId: string, identity: Partial<CreateCustomerInput> = {}) {
    // B4: a cached email-only customer gets "missing bvn…" from POST /api/virtual-accounts,
    // so a request carrying KYC fields gets (and remembers) a customer created with them.
    if (Object.keys(identity).length > 0) return this.kycCustomerId(funderId, identity);
    let id = this.ids.get(funderId);
    if (!id) {
      id = this.client
        .createCustomer({
          email: this.emailFor(funderId),
          customer_type: "individual",
          reference: `funder-${safePart(funderId)}`,
          ...identity,
        })
        .then((c) => c.id);
      this.ids.set(funderId, id);
      id.catch(() => this.ids.delete(funderId));
    }
    return id;
  }

  private kycCustomerId(funderId: string, identity: Partial<CreateCustomerInput>) {
    let id = this.kycIds.get(funderId);
    if (!id) {
      // Already have an email-only customer: Bitnob may refuse the same email/reference twice.
      const upgrade = this.ids.has(funderId);
      const email = upgrade ? this.emailFor(funderId).replace("@", "+kyc@") : this.emailFor(funderId);
      const reference = upgrade ? `funder-${safePart(funderId)}-kyc` : `funder-${safePart(funderId)}`;
      id = this.client
        .createCustomer({ email, customer_type: "individual", reference, ...identity })
        .then((c) => c.id);
      this.kycIds.set(funderId, id);
      // Later calls without KYC (Lightning) can reuse it too.
      if (!this.ids.has(funderId)) this.ids.set(funderId, id);
      id.catch(() => {
        if (this.kycIds.get(funderId) === id) this.kycIds.delete(funderId);
        if (this.ids.get(funderId) === id) this.ids.delete(funderId);
      });
    }
    return id;
  }
}

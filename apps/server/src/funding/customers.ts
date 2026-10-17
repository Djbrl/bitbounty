import type { BitnobClient, CreateCustomerInput } from "@bitbounty/bitnob";

/**
 * Bitnob requires a customer for Lightning invoices and naira accounts.
 * One Bitnob customer per funder, created on first use and remembered.
 */
export interface FunderCustomers {
  /** `identity` is needed for naira accounts (KYC fields); Lightning only needs the email. */
  customerId(funderId: string, identity?: Partial<CreateCustomerInput>): Promise<string>;
}

export class BitnobFunderCustomers implements FunderCustomers {
  private ids = new Map<string, Promise<string>>();

  constructor(
    private client: Pick<BitnobClient, "createCustomer">,
    /** Placeholder emails until funders sign in with a real one (W9). */
    private emailFor: (funderId: string) => string = (id) => `funder-${id}@bitbounty.invalid`,
  ) {}

  customerId(funderId: string, identity: Partial<CreateCustomerInput> = {}) {
    let id = this.ids.get(funderId);
    if (!id) {
      id = this.client
        .createCustomer({
          email: this.emailFor(funderId),
          customer_type: "individual",
          reference: `funder-${funderId}`,
          ...identity,
        })
        .then((c) => c.id);
      this.ids.set(funderId, id);
      id.catch(() => this.ids.delete(funderId));
    }
    return id;
  }
}

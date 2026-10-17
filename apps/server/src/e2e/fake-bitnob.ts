import type { Bank, LightningInvoice, Payout, TradingOrder, TradingQuote, VirtualAccount } from "@bitbounty/bitnob";
import type { Rates } from "../funding/pricing.js";

/**
 * In-memory Bitnob for the offline end-to-end run: every call the funding (B1, B4) and
 * payout (B2) blocks make, with statuses the script controls.
 */
export class FakeBitnob {
  invoices = new Map<string, LightningInvoice>();
  payouts = new Map<string, Payout>();
  orders = new Map<string, TradingOrder>();
  private n = 0;

  readonly rates: Rates = {
    xofPerUsdt: async () => 600,
    usdtPerBtc: async () => 100_000,
    ngnPerUsdt: async () => 1_500,
  };

  private id(prefix: string) {
    return `${prefix}-${++this.n}`;
  }

  async createCustomer() {
    return { id: this.id("cust") } as never;
  }

  // B1
  async createLightningInvoice(input: { amount: number; reference: string; expiry: number }) {
    const id = this.id("inv");
    const inv: LightningInvoice = {
      id,
      request: `lnbcrt${input.amount}n1fake${id}`,
      payment_hash: `hash-${id}`,
      status: "pending",
      reference: input.reference,
      expires_at: new Date(Date.now() + input.expiry * 1000).toISOString(),
    };
    this.invoices.set(id, inv);
    return inv;
  }
  async getLightningInvoice(id: string) {
    const inv = this.invoices.get(id);
    if (!inv) throw new Error(`no invoice ${id}`);
    return inv;
  }
  /** What a funder's wallet does. */
  payInvoice(id: string) {
    this.invoices.get(id)!.status = "paid";
  }

  // B4
  async createVirtualAccount(input: { reference: string; customer_id: string }): Promise<VirtualAccount> {
    return {
      id: this.id("va"),
      account_number: "9000000001",
      account_name: "Ada Okafor",
      bank_name: "Sandbox Bank",
      reference: input.reference,
      customer_id: input.customer_id,
      currency: "NGN",
      status: "active",
    };
  }
  async simulateDeposit(virtualAccountId: string) {
    const ref = this.id("sbx-dep");
    return {
      transaction: { id: ref, virtual_account_id: virtualAccountId, amount: "100000", currency: "NGN", status: "completed", reference: ref },
      new_balance: "0",
    };
  }
  async createTradingQuote(input: { quantity: string; quote_currency: string }): Promise<TradingQuote> {
    return {
      id: this.id("q"),
      base_currency: "NGN",
      quote_currency: input.quote_currency,
      side: "SELL",
      quantity: input.quantity,
      price: "0.0000000067",
      expires_at: new Date(Date.now() + 30_000).toISOString(),
      exchange: { send_quantity: input.quantity, send_currency: "NGN", receive_quantity: "0.0002", receive_currency: input.quote_currency },
    };
  }
  async createTradingOrder(input: { quote_id: string; reference: string; quantity: string }) {
    const order = { id: this.id("order"), status: "filled", quote_id: input.quote_id, reference: input.reference, quantity: input.quantity } as TradingOrder;
    this.orders.set(input.reference, order);
    return order;
  }
  async getTradingOrder(ref: string) {
    const o = this.orders.get(ref);
    if (!o) throw Object.assign(new Error("not found"), { status: 404 });
    return o;
  }

  // B2
  async getBanks(): Promise<Bank[]> {
    return [
      { bank_name: "Wave", bank_code: "WAVE_SN" },
      { bank_name: "Orange Money", bank_code: "OM_SN" },
    ];
  }
  async createPayoutQuote(input: { reference: string; settlement_amount?: string }) {
    for (const p of this.payouts.values()) if (p.reference === input.reference) return p;
    const id = this.id("payout");
    const p = {
      id,
      quote_id: `QT-${id}`,
      status: "QUOTE",
      reference: input.reference,
      settlement_amount: input.settlement_amount ?? "0",
      expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    } as unknown as Payout;
    this.payouts.set(id, p);
    return p;
  }
  async initializePayout(quoteId: string) {
    const p = this.byQuote(quoteId);
    p.status = "INITIATED";
    return p;
  }
  async finalizePayout(quoteId: string) {
    const p = this.byQuote(quoteId);
    p.status = "processing";
    return p;
  }
  async getPayout(id: string) {
    const p = this.payouts.get(id);
    if (!p) throw new Error(`no payout ${id}`);
    return p;
  }
  private byQuote(quoteId: string) {
    for (const p of this.payouts.values()) if (p.quote_id === quoteId) return p;
    throw new Error(`no quote ${quoteId}`);
  }
}

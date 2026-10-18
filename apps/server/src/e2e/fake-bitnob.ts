import { BitnobError, type Bank, type LightningInvoice, type LightningPayment, type Payout, type TradingOrder, type TradingQuote, type VirtualAccount } from "@bitbounty/bitnob";
import type { Rates } from "../funding/pricing.js";
import type { LnurlResolver } from "../payouts/lnurl.js";

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
  /** Sandbox simulate-payment (B1 "Pay (sandbox)" button). */
  simulated: string[] = [];
  async simulateLightningPayment(id: string) {
    const inv = await this.getLightningInvoice(id);
    this.simulated.push(id);
    inv.status = "paid";
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

  // B6: Lightning payouts. `payLightningInvoice` is idempotent on `reference` (as Bitnob documents)
  // and a BOLT11 settles at most once (as Lightning guarantees): `settled` counts real payments.
  lnPayments = new Map<string, LightningPayment>();
  /** Payment hash (here: the BOLT11 itself) → reference of the one payment that settled it. */
  settled = new Map<string, string>();
  /** Status a new payment starts in. */
  lnInitialStatus: "pending" | "paid" = "pending";
  async payLightningInvoice(input: { request: string; reference: string }): Promise<LightningPayment> {
    const existing = this.lnPayments.get(input.reference);
    if (existing) return { ...existing };
    const p: LightningPayment = { id: this.id("lnpay"), status: "pending", reference: input.reference, request: input.request };
    this.lnPayments.set(input.reference, p);
    if (this.lnInitialStatus === "paid") this.settleLightning(input.reference);
    return { ...p };
  }
  async getLightningPayment(id: string): Promise<LightningPayment> {
    for (const p of this.lnPayments.values()) if (p.id === id) return { ...p };
    throw new BitnobError(`GET /api/lightning/invoices/${id} failed: 404`, 404, "NOT_FOUND");
  }
  /** The Lightning network delivers (or refuses) the payment. */
  settleLightning(reference: string, status: "paid" | "failed" = "paid") {
    const p = this.lnPayments.get(reference);
    if (!p) throw new Error(`no payment ${reference}`);
    const request = String(p.request);
    if (status === "paid" && this.settled.has(request) && this.settled.get(request) !== reference) {
      p.status = "failed"; // already paid by another payment: Lightning refuses a second settlement
      return;
    }
    p.status = status;
    if (status === "paid") {
      this.settled.set(request, reference);
      p.preimage = "ab".repeat(32);
    }
  }

  /** LNURL-pay for the e2e run: every Lightning Address answers with a fake invoice for the exact amount. */
  readonly lnurl: LnurlResolver = {
    invoiceFor: async (address: string, amountMsat: number) => {
      const n = ++this.n;
      return {
        bolt11: `lntb${amountMsat / 1000}0n1fake${n}${address.replace(/[^a-z0-9]/g, "")}`,
        paymentHash: n.toString(16).padStart(64, "0"),
        amountMsat,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      };
    },
  };

  // B2 (mobile money, legacy: still used by B3's test payout)
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

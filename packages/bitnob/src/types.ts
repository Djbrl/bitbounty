/**
 * Request and response shapes for the calls BitBounty uses, from the Bitnob v2
 * OpenAPI spec (https://bitnob.dev/api-collections/swagger/bitnob-api-v2.openapi.json).
 * Bitnob returns amounts as strings; we keep them as strings here and convert
 * to integers at the edge of our own code.
 */

export interface Envelope<T> {
  success: boolean;
  message: string;
  data: T;
  timestamp: string;
}

export interface WhoAmI {
  active: boolean;
  active_company_id: string;
  auth_method: string;
  client_id: string;
  client_name: string;
  environment: "sandbox" | "production" | string;
  permissions: unknown;
}

export interface CreateCustomerInput {
  email: string;
  customer_type: "individual" | "business";
  first_name?: string;
  last_name?: string;
  phone_number?: string;
  country_code?: string;
  date_of_birth?: string;
  id_type?: string;
  id_number?: string;
  company_name?: string;
  registration_number?: string;
  reference?: string;
}

export interface Customer {
  id: string;
  email: string;
  customer_type: string;
  first_name?: string;
  last_name?: string;
  phone_number?: string;
  is_active: boolean;
  created_at: string;
}

export interface CreateLightningInvoiceInput {
  customer_id: string;
  /** Satoshis, integer. */
  amount: number;
  description: string;
  /** Seconds. */
  expiry: number;
  reference: string;
}

/** The spec doesn't document the invoice body; these are the fields we rely on. */
export interface LightningInvoice {
  id: string;
  /** BOLT11 payment request. */
  request?: string;
  payment_hash?: string;
  status?: string;
  amount?: number | string;
  reference?: string;
  expires_at?: string;
  [key: string]: unknown;
}

export interface PayoutQuoteInput {
  from_asset: "BTC" | "USDT" | "USDC";
  to_currency: string;
  country: string;
  source: "offchain" | "onchain";
  /** What the beneficiary receives, in `to_currency` (string, major units). */
  settlement_amount?: string;
  /** What we send, in `from_asset`. One of `amount` / `settlement_amount`. */
  amount?: string;
  payment_reason: string;
  reference: string;
  chain?: string;
}

export interface PayoutQuote {
  id: string;
  quote_id: string;
  status: string;
  from_asset: string;
  to_currency: string;
  sat_amount: string;
  amount: string;
  settlement_amount: string;
  fees: string;
  exchange_rate: { rate: string; btc_rate: string; currency: string; effective_rate: string };
  reference: string;
  country: string;
  expires_at: string;
}

export interface PayoutBeneficiary {
  destination_type: "mobile_money" | "bank" | "swift";
  country: string;
  account_name: string;
  /** Mobile money: the number without "+", e.g. "221771234567". */
  account_number: string;
  /** From `GET /api/payouts/banks/:country`. */
  bank_code: string;
}

export interface InitializePayoutInput {
  reference: string;
  beneficiary: PayoutBeneficiary;
  /** Required by the spec: where Bitnob sends this payout's webhooks. */
  callback_url: string;
  payment_reason?: string;
  customer_id?: string;
}

/** A payout record (quote, initialize and GET all return this shape). */
export interface Payout extends PayoutQuote {
  beneficiary?: Partial<PayoutBeneficiary>;
  provider_settlement_id?: string;
  [key: string]: unknown;
}

export interface CreateVirtualAccountInput {
  customer_id: string;
  currency: "NGN";
  reference: string;
  account_alias?: string;
}

export interface VirtualAccount {
  id: string;
  account_number: string;
  account_name: string;
  bank_name: string;
  reference: string;
  customer_id: string;
  currency: string;
  status: string;
}

export interface SimulatedDeposit {
  transaction: {
    id: string;
    virtual_account_id: string;
    /** Kobo, as a string. */
    amount: string;
    currency: string;
    status: string;
    reference: string;
  };
  /** Kobo, as a string. */
  new_balance: string;
}

export interface TradingQuoteInput {
  base_currency: string;
  quote_currency: string;
  side: "BUY" | "SELL";
  /** Major units of the base currency, e.g. "5000" naira or "0.001" BTC. */
  quantity: string;
  quantity_in_base_units?: boolean;
}

export interface TradingQuote {
  id: string;
  base_currency: string;
  quote_currency: string;
  side: string;
  quantity: string;
  price: string;
  expires_at: string;
  exchange: {
    send_quantity: string;
    send_currency: string;
    receive_quantity: string;
    receive_currency: string;
  };
}

export interface Bank {
  bank_name: string;
  bank_code: string;
}

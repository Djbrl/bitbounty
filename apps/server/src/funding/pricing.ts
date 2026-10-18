import type { BitnobClient } from "@bitbounty/bitnob";

/**
 * What a funder pays for a bounty, in whole FCFA: the bounty (what the developer
 * receives) + 5% BitBounty fee + 3% exchange-rate buffer (docs/product.md, Flow 2).
 * All integers; each part is rounded up so we never under-collect.
 */
export interface FundingPrice {
  amountXof: number;
  feeXof: number;
  bufferXof: number;
  totalXof: number;
}

export const FEE_PERCENT = 5;
export const BUFFER_PERCENT = 3;

export function priceBounty(amountXof: number): FundingPrice {
  const feeXof = Math.ceil((amountXof * FEE_PERCENT) / 100);
  const bufferXof = Math.ceil((amountXof * BUFFER_PERCENT) / 100);
  return { amountXof, feeXof, bufferXof, totalXof: amountXof + feeXof + bufferXof };
}

/** Exchange rates the funding rails need. Injectable so tests and the offline demo use fixed rates. */
export interface Rates {
  /** FCFA per 1 USDT. */
  xofPerUsdt(): Promise<number>;
  /** USDT per 1 BTC. */
  usdtPerBtc(): Promise<number>;
  /** Naira per 1 USDT. */
  ngnPerUsdt(): Promise<number>;
}

/** Satoshis needed to cover `xof` FCFA, rounded up. */
export async function xofToSats(rates: Rates, xof: number): Promise<number> {
  const [xofUsdt, usdtBtc] = await Promise.all([rates.xofPerUsdt(), rates.usdtPerBtc()]);
  return Math.ceil((xof * 1e8) / (xofUsdt * usdtBtc));
}

/** Whole naira needed to cover `xof` FCFA, rounded up. */
export async function xofToNaira(rates: Rates, xof: number): Promise<number> {
  const [xofUsdt, ngnUsdt] = await Promise.all([rates.xofPerUsdt(), rates.ngnPerUsdt()]);
  return Math.ceil((xof * ngnUsdt) / xofUsdt);
}

/** Live rates from Bitnob, cached for `ttlMs`. */
export class BitnobRates implements Rates {
  private cache = new Map<string, { value: number; at: number }>();

  constructor(
    private client: Pick<BitnobClient, "getExchangeRate" | "getTradingPrice">,
    private ttlMs = 60_000,
    private now: () => number = Date.now,
  ) {}

  xofPerUsdt() {
    return this.cached("USDT/XOF", async () => Number((await this.client.getExchangeRate("USDT", "XOF")).mid_rate));
  }

  ngnPerUsdt() {
    return this.cached("USDT/NGN", async () => Number((await this.client.getExchangeRate("USDT", "NGN")).mid_rate));
  }

  usdtPerBtc() {
    return this.cached("BTC/USDT", async () => Number((await this.client.getTradingPrice("BTC", "USDT")).price));
  }

  private async cached(key: string, load: () => Promise<number>): Promise<number> {
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value;
    const value = await load();
    if (!Number.isFinite(value) || value <= 0) throw new Error(`Bitnob returned an unusable ${key} rate: ${value}`);
    this.cache.set(key, { value, at: this.now() });
    return value;
  }
}

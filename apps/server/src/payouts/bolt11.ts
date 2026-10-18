/**
 * Minimal BOLT11 decoder: what a payer must check before paying an invoice it didn't create
 * (amount, network, payment hash, expiry, description hash). No dependency, no signature check:
 * Bitnob's node validates the signature when it pays, and we never trust the payee anyway
 * (the amount we pay is the one we decided, checked against the invoice).
 * Spec: https://github.com/lightning/bolts/blob/master/11-payment-encoding.md
 */

export type LightningNetwork = "bitcoin" | "testnet" | "signet" | "regtest";

const PREFIX_NETWORK: Record<string, LightningNetwork> = {
  bc: "bitcoin",
  tb: "testnet",
  tbs: "signet",
  bcrt: "regtest",
};

export interface DecodedBolt11 {
  network: LightningNetwork;
  /** Exact amount in millisatoshis; null for an "any amount" invoice. */
  amountMsat: bigint | null;
  /** Unix seconds. */
  timestamp: number;
  /** Seconds after `timestamp` (default 3600). */
  expirySeconds: number;
  /** `timestamp + expirySeconds`, unix seconds. */
  expiresAt: number;
  /** Hex, 32 bytes. */
  paymentHash: string;
  /** Hex, 32 bytes, when the invoice commits to a hashed description (LNURL-pay). */
  descriptionHash: string | null;
  description: string | null;
}

export class Bolt11Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Bolt11Error";
  }
}

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const b = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >>> i) & 1) chk ^= GEN[i]!;
  }
  return chk >>> 0;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

/** Bech32 without BIP-173's 90-character limit (invoices are longer). */
function bech32Decode(input: string): { hrp: string; words: number[] } {
  if (input.length > 7089) throw new Bolt11Error("invoice too long");
  if (input !== input.toLowerCase() && input !== input.toUpperCase()) throw new Bolt11Error("mixed case");
  const s = input.toLowerCase();
  const pos = s.lastIndexOf("1");
  if (pos < 1 || pos + 7 > s.length) throw new Bolt11Error("not bech32");
  const hrp = s.slice(0, pos);
  const words: number[] = [];
  for (const c of s.slice(pos + 1)) {
    const v = CHARSET.indexOf(c);
    if (v === -1) throw new Bolt11Error("invalid bech32 character");
    words.push(v);
  }
  if (polymod([...hrpExpand(hrp), ...words]) !== 1) throw new Bolt11Error("bad checksum");
  return { hrp, words: words.slice(0, -6) };
}

function wordsToInt(words: number[]): number {
  let n = 0;
  for (const w of words) n = n * 32 + w;
  return n;
}

function wordsToBytes(words: number[]): Uint8Array {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  for (const w of words) {
    acc = (acc << 5) | w;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
    acc &= (1 << bits) - 1;
  }
  return Uint8Array.from(out);
}

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

/** `2500u` → 250_000_000 msat. BOLT11: the `p` multiplier must end in 0 (no sub-msat). */
function parseAmount(digits: string, multiplier: string | undefined): bigint {
  if (!/^[1-9]\d*$/.test(digits)) throw new Bolt11Error("invalid amount");
  const n = BigInt(digits);
  switch (multiplier) {
    case undefined:
      return n * 100_000_000_000n;
    case "m":
      return n * 100_000_000n;
    case "u":
      return n * 100_000n;
    case "n":
      return n * 100n;
    case "p":
      if (n % 10n !== 0n) throw new Bolt11Error("sub-millisatoshi amount");
      return n / 10n;
    default:
      throw new Bolt11Error("invalid amount multiplier");
  }
}

export function decodeBolt11(invoice: string): DecodedBolt11 {
  const raw = invoice.trim().replace(/^lightning:/i, "");
  const { hrp, words } = bech32Decode(raw);
  const m = /^ln(bcrt|tbs|tb|bc)(?:(\d+)([munp])?)?$/.exec(hrp);
  if (!m) throw new Bolt11Error(`not a BOLT11 invoice (prefix ${hrp.slice(0, 8)})`);
  const network = PREFIX_NETWORK[m[1]!]!;
  const amountMsat = m[2] ? parseAmount(m[2], m[3]) : null;

  // 7 words of timestamp, tagged fields, then a 104-word (65-byte) signature.
  if (words.length < 7 + 104) throw new Bolt11Error("invoice too short");
  const timestamp = wordsToInt(words.slice(0, 7));
  const tagged = words.slice(7, words.length - 104);

  let paymentHash: string | null = null;
  let descriptionHash: string | null = null;
  let description: string | null = null;
  let expirySeconds = 3600;
  for (let i = 0; i < tagged.length; ) {
    if (i + 3 > tagged.length) throw new Bolt11Error("truncated tagged field");
    const type = CHARSET[tagged[i]!];
    const len = tagged[i + 1]! * 32 + tagged[i + 2]!;
    const data = tagged.slice(i + 3, i + 3 + len);
    if (data.length !== len) throw new Bolt11Error("truncated tagged field");
    i += 3 + len;
    // Fields of the wrong length are skipped, as BOLT11 requires of readers.
    if (type === "p" && len === 52 && paymentHash === null) paymentHash = hex(wordsToBytes(data));
    else if (type === "h" && len === 52 && descriptionHash === null) descriptionHash = hex(wordsToBytes(data));
    else if (type === "d" && description === null) description = Buffer.from(wordsToBytes(data)).toString("utf8");
    else if (type === "x") expirySeconds = wordsToInt(data);
  }
  if (!paymentHash) throw new Bolt11Error("no payment hash");
  return {
    network,
    amountMsat,
    timestamp,
    expirySeconds,
    expiresAt: timestamp + expirySeconds,
    paymentHash,
    descriptionHash,
    description,
  };
}

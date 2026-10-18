import { createHash } from "node:crypto";

/**
 * Test-only BOLT11 encoder: builds invoices with any amount, network, expiry and description hash
 * (the signature is zeros: our decoder doesn't check it, Bitnob's node does).
 */
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

function toWords(bytes: Uint8Array): number[] {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out.push((acc >> bits) & 31);
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out.push((acc << (5 - bits)) & 31);
  return out;
}

function intWords(n: number, len?: number): number[] {
  const out: number[] = [];
  do {
    out.unshift(n % 32);
    n = Math.floor(n / 32);
  } while (n > 0);
  while (len !== undefined && out.length < len) out.unshift(0);
  return out;
}

function tag(type: string, data: number[]): number[] {
  return [CHARSET.indexOf(type), Math.floor(data.length / 32), data.length % 32, ...data];
}

export interface EncodeOptions {
  /** Millisatoshis; omit for "any amount". */
  amountMsat?: number | bigint;
  network?: "bc" | "tb" | "tbs" | "bcrt";
  /** Unix seconds. */
  timestamp: number;
  expirySeconds?: number;
  paymentHash?: string;
  description?: string;
  /** Metadata string to commit to (`h` = sha256(metadata)). */
  metadata?: string;
}

export function encodeBolt11(o: EncodeOptions): string {
  const amount = o.amountMsat === undefined ? "" : `${BigInt(o.amountMsat) * 10n}p`;
  const hrp = `ln${o.network ?? "tb"}${amount}`;
  const hash = o.paymentHash ?? createHash("sha256").update(`${o.timestamp}-${String(o.amountMsat)}`).digest("hex");
  const words = [
    ...intWords(o.timestamp, 7),
    ...tag("p", toWords(Buffer.from(hash, "hex"))),
    ...(o.description !== undefined ? tag("d", toWords(Buffer.from(o.description, "utf8"))) : []),
    ...(o.metadata !== undefined ? tag("h", toWords(createHash("sha256").update(o.metadata, "utf8").digest())) : []),
    ...(o.expirySeconds !== undefined ? tag("x", intWords(o.expirySeconds)) : []),
    ...new Array<number>(104).fill(0),
  ];
  const mod = polymod([...hrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, i) => (mod >> (5 * (5 - i))) & 31);
  return `${hrp}1${[...words, ...checksum].map((w) => CHARSET[w]).join("")}`;
}

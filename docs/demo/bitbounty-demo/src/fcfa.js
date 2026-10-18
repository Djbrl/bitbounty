// Small helpers for FCFA (XOF) amounts and Lightning sats. No dependencies.

export const SATS_PER_BTC = 100_000_000;

/** Groups the digits of a whole number by thousands with a space: 25000 → "25 000". */
export function groupThousands(n) {
  if (!Number.isInteger(n)) throw new TypeError(`expected a whole number, got ${n}`);
  const sign = n < 0 ? "-" : "";
  return sign + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/, " ");
}

/** 25000 → "25 000 FCFA". FCFA has no cents: amounts are whole numbers. */
export function formatXof(amount) {
  return `${groupThousands(amount)} FCFA`;
}

/** 40323 → "40 323 sats". */
export function formatSats(sats) {
  return `${groupThousands(sats)} sats`;
}

/** FCFA → sats at a rate given in FCFA per bitcoin, rounded to the nearest sat. */
export function xofToSats(xof, xofPerBtc) {
  return Math.round((xof * SATS_PER_BTC) / xofPerBtc);
}

/** sats → FCFA at a rate given in FCFA per bitcoin, rounded to the nearest franc. */
export function satsToXof(sats, xofPerBtc) {
  return Math.round((sats * xofPerBtc) / SATS_PER_BTC);
}

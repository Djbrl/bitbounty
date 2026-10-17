/** 10000 → "10 000" (plain spaces, same output on every server locale). */
export function groupThousands(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

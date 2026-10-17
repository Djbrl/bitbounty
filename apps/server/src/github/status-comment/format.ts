import { escapeInline } from "./escape.js";

export type Lang = "en" | "fr";

/** Thousands grouped with a no-break space, as in the mockup: `10 000`. Same in both languages. */
export function groupThousands(n: number): string {
  const sign = n < 0 ? "-" : "";
  const digits = String(Math.trunc(Math.abs(n)));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function formatXof(amount: number): string {
  return `${groupThousands(amount)} FCFA`;
}

export function formatSats(sats: number): string {
  return `${groupThousands(sats)} sats`;
}

const DAYS: Record<Lang, readonly string[]> = {
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  fr: ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."],
};
const MONTHS: Record<Lang, readonly string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  fr: [
    "janv.",
    "févr.",
    "mars",
    "avr.",
    "mai",
    "juin",
    "juil.",
    "août",
    "sept.",
    "oct.",
    "nov.",
    "déc.",
  ],
};

/**
 * Deterministic UTC date (Dakar is UTC+0, no DST), no Intl so snapshots don't
 * depend on the machine: `Sun 19 Oct, 18:42 UTC` / `dim. 19 oct., 18:42 UTC`.
 * An unparseable string is escaped and shown as is.
 */
export function formatDate(iso: string, lang: Lang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return escapeInline(iso, 40);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const day = DAYS[lang][d.getUTCDay()];
  const month = MONTHS[lang][d.getUTCMonth()];
  const sep = lang === "fr" ? " à " : ", ";
  return `${day} ${d.getUTCDate()} ${month}${sep}${hh}:${mm} UTC`;
}

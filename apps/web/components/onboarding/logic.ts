// Pure logic for the payout account (/me, and step 3 of /welcome): a Lightning Address (B6 pays it in sats).
// No React, no fetch: unit-tested in onboarding.test.tsx.
import { parseLightningAddress } from "@bitbounty/core";
import type { Me } from "../../../../fixtures/types";

export type MeState = "new" | "pending" | "sms_ok" | "verified";
export const ME_STATES: readonly MeState[] = ["new", "pending", "sms_ok", "verified"];

/** `?state=` from the URL, validated (unknown values fall back to the API default). */
export function parseMeState(raw: string | string[] | undefined): MeState | undefined {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return ME_STATES.includes(v as MeState) ? (v as MeState) : undefined;
}

/** The Lightning Address already saved (masked), or null when the developer still has to add one. */
export function savedAddress(account: Me["payoutAccount"]): string | null {
  return account?.lightningAddress ?? null;
}

export type AddressCheck = { ok: true; address: string } | { ok: false; error: "empty" | "format" };

/** Same rule as the server (LUD-16 `user@domain`, lower-cased). The server also checks that it resolves. */
export function checkAddressInput(raw: string): AddressCheck {
  if (!raw.trim()) return { ok: false, error: "empty" };
  const a = parseLightningAddress(raw);
  return a ? { ok: true, address: `${a.user}@${a.domain}` } : { ok: false, error: "format" };
}

export const ADDRESS_ERROR_FR: Record<string, string> = {
  empty: "Entre ta Lightning Address.",
  format: "Une Lightning Address ressemble à un e-mail : toi@blink.sv, toi@walletofsatoshi.com…",
  invalid_lightning_address: "Une Lightning Address ressemble à un e-mail : toi@blink.sv, toi@walletofsatoshi.com…",
  lightning_address_unreachable: "Cette adresse ne répond pas. Vérifie-la dans ton wallet (Blink, Wallet of Satoshi…) et réessaie.",
  unauthorized: "Session expirée. Reconnecte-toi avec GitHub.",
  network_error: "Pas de connexion. Réessaie dans un instant.",
};
export const addressError = (code: string) => ADDRESS_ERROR_FR[code] ?? "Une erreur est survenue. Réessaie.";

// ---------- dates (UTC = Dakar time; no Intl so server and client agree) ----------

const MONTHS_FR = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** "2026-10-17T14:32:00Z" -> "17 oct. 2026 à 14:32". */
export function formatDateFr(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS_FR[d.getUTCMonth()]} ${d.getUTCFullYear()} à ${hh}:${mm}`;
}

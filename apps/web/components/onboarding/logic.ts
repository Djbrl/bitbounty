// Pure logic for the /me onboarding (W4): steps, Senegal phone numbers, OTP, test amount.
// No React, no fetch: unit-tested in onboarding.test.tsx.
import type { Me, PayoutProvider } from "../../../../fixtures/types";

export type OnboardingStep = "account" | "sms" | "amount" | "verified";
export type MeState = "new" | "pending" | "sms_ok" | "verified";
export const ME_STATES: readonly MeState[] = ["new", "pending", "sms_ok", "verified"];

/** Where the developer resumes, from the account status the API returns. */
export function stepFromAccount(account: Me["payoutAccount"]): OnboardingStep {
  if (!account) return "account";
  if (account.status === "pending") return "sms";
  if (account.status === "sms_ok") return "amount";
  return "verified";
}

/** "ÉTAPE n / 3" for the three input steps. */
export const STEP_NUMBER: Record<Exclude<OnboardingStep, "verified">, number> = { account: 1, sms: 2, amount: 3 };
export const STEP_COUNT = 3;

/** `?state=` from the URL, validated (unknown values fall back to the API default). */
export function parseMeState(raw: string | string[] | undefined): MeState | undefined {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return ME_STATES.includes(v as MeState) ? (v as MeState) : undefined;
}

// ---------- providers ----------

/** Providers offered on the form (Free Money is in core but not offered yet). */
export const OFFERED_PROVIDERS: readonly { id: PayoutProvider; label: string }[] = [
  { id: "wave", label: "Wave" },
  { id: "orange", label: "Orange Money" },
];

const PROVIDER_LABEL: Record<PayoutProvider, string> = { wave: "Wave", orange: "Orange Money", free: "Free Money" };
export const providerLabel = (p: PayoutProvider) => PROVIDER_LABEL[p];

// ---------- phone (Senegal, +221) ----------

export type PhoneError = "empty" | "not_digits" | "wrong_country" | "too_short" | "too_long" | "bad_prefix";
export type PhoneResult = { ok: true; national: string; e164: string } | { ok: false; error: PhoneError };

export const PHONE_ERROR_FR: Record<PhoneError, string> = {
  empty: "Entre ton numéro.",
  not_digits: "Le numéro ne doit contenir que des chiffres.",
  wrong_country: "Seuls les numéros du Sénégal (+221) sont acceptés pour l'instant.",
  too_short: "Numéro incomplet : il faut 9 chiffres, par ex. 77 412 58 30.",
  too_long: "Numéro trop long : il faut 9 chiffres après +221.",
  bad_prefix: "Un numéro mobile sénégalais commence par 7 (70, 75, 76, 77, 78…).",
};

/**
 * Accepts what people actually type or paste: "77 412 58 30", "+221 77 412 58 30",
 * "00221774125830", "221-77-412-58-30", "77.412.58.30". Returns the 9-digit national number and E.164.
 */
export function normalizeSnPhone(raw: string): PhoneResult {
  let s = raw.replace(/[\s.\-()]/g, "");
  if (!s) return { ok: false, error: "empty" };
  if (s.startsWith("+")) {
    if (!s.startsWith("+221")) return { ok: false, error: "wrong_country" };
    s = s.slice(4);
  } else if (s.startsWith("00")) {
    if (!s.startsWith("00221")) return { ok: false, error: "wrong_country" };
    s = s.slice(5);
  } else if (s.length === 12 && s.startsWith("221")) {
    s = s.slice(3);
  }
  if (!/^\d+$/.test(s)) return { ok: false, error: "not_digits" };
  if (s.length < 9) return { ok: false, error: "too_short" };
  if (s.length > 9) return { ok: false, error: "too_long" };
  if (!s.startsWith("7")) return { ok: false, error: "bad_prefix" };
  return { ok: true, national: s, e164: `+221${s}` };
}

/** "774125830" -> "77 412 58 30". */
export function formatSnPhone(national: string): string {
  return `${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5, 7)} ${national.slice(7, 9)}`;
}

/** "774125830" -> "+221 77 ••• •• 30" (same mask as the API's phoneMasked). */
export function maskSnPhone(national: string): string {
  return `+221 ${national.slice(0, 2)} ••• •• ${national.slice(7, 9)}`;
}

// ---------- SMS code ----------

export const OTP_LENGTH = 6;
/** Keeps digits only (pasted "424 242" works), max 6. */
export const sanitizeOtp = (raw: string) => raw.replace(/\D/g, "").slice(0, OTP_LENGTH);
export const RESEND_SECONDS = 45;
/** 41 -> "0:41". */
export const formatCountdown = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// ---------- test amount ----------

export const MAX_AMOUNT_ATTEMPTS = 3;

/** "137", "137 F", "137 FCFA", "1 37" -> 137; anything else (decimals, letters, empty) -> null. */
export function parseAmount(raw: string): number | null {
  const s = raw.replace(/[\s]/g, "").replace(/(f\s*cfa|cfa|f|xof)$/i, "");
  if (!/^\d{1,7}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

/** Attempts left after one more wrong amount: trusts whichever is stricter, the server or our count. */
export function attemptsLeftAfterFailure(failedSoFar: number, serverLeft?: number): number {
  const local = Math.max(0, MAX_AMOUNT_ATTEMPTS - (failedSoFar + 1));
  return typeof serverLeft === "number" ? Math.max(0, Math.min(local, serverLeft)) : local;
}

export type AmountFailure = { kind: "wrong"; attemptsLeft: number } | { kind: "locked" } | { kind: "other" };

/**
 * What a failed POST /confirm means on screen. The server answers 422 `wrong_amount` + `attemptsLeft`,
 * and 423 `locked` once 3 wrong amounts are in (also for any request made while locked).
 */
export function classifyAmountFailure(res: { status: number; error: string; attemptsLeft?: number }, failedSoFar: number): AmountFailure {
  if (res.status === 423 || res.error === "locked") return { kind: "locked" };
  if (res.error !== "wrong_amount") return { kind: "other" };
  const left = attemptsLeftAfterFailure(failedSoFar, res.attemptsLeft);
  return left === 0 ? { kind: "locked" } : { kind: "wrong", attemptsLeft: left };
}

// ---------- dates (UTC = Dakar time; no Intl so server and client agree) ----------

const MONTHS_FR = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** "2026-10-17T14:32:00Z" -> "17 oct. 2026 à 14:32". */
export function formatDateFr(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS_FR[d.getUTCMonth()]} ${d.getUTCFullYear()} à ${hh}:${mm}`;
}

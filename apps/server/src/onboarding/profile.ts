import { parseLightningAddress, USER_MODES, type UserMode } from "@bitbounty/core";

/**
 * U1: what the /welcome onboarding saves for a GitHub login. `defaultMode` and `onboardedAt` are
 * columns of `users` (L1); the rest of the answers live in `users.preferences` (jsonb), and the
 * Lightning Address on `payout_accounts.lightning_address` (B6 pays it).
 */
export type OnboardingRole = UserMode | "both";
export type DisplayCurrency = "xof" | "ngn" | "sats";
export type UiLanguage = "fr" | "en";

export const ONBOARDING_STEPS = 3;
export const ROLES: readonly OnboardingRole[] = [...USER_MODES, "both"];
export const CURRENCIES: readonly DisplayCurrency[] = ["xof", "ngn", "sats"];
export const LANGUAGES: readonly UiLanguage[] = ["fr", "en"];
const MAX_STACK = 20;

export interface Preferences {
  role: OnboardingRole | null;
  stack: string[];
  currency: DisplayCurrency;
  language: UiLanguage;
  /** Maintainer: the repo picked in step 2 (for "Price my backlog"). */
  repo: string | null;
  /** 1..3, where /welcome resumes. */
  step: number;
}

export interface Profile {
  defaultMode: UserMode | null;
  onboardedAt: string | null;
  preferences: Preferences;
  /** Full address (server side only; routes mask it). */
  lightningAddress: string | null;
}

export const DEFAULT_PREFERENCES: Preferences = { role: null, stack: [], currency: "xof", language: "fr", repo: null, step: 1 };

/** `defaultMode` isn't here: U2's POST /api/me/mode saves it (users.default_mode). */
export interface ProfilePatch {
  preferences?: Partial<Preferences>;
  /** Sets onboardedAt (once; later saves keep the first date). */
  done?: boolean;
}

export interface ProfileStore {
  get(login: string): Promise<Profile>;
  update(login: string, patch: ProfilePatch): Promise<Profile>;
  setLightningAddress(login: string, address: string): Promise<void>;
}

const REPO_RE = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

/** Reads stored jsonb (or anything) into valid preferences, dropping unknown or bad values. */
export function normalizePreferences(raw: unknown, base: Preferences = DEFAULT_PREFERENCES): Preferences {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Preferences = { ...base, stack: [...base.stack] };
  if (r.role === null || ROLES.includes(r.role as OnboardingRole)) out.role = (r.role as OnboardingRole | null) ?? null;
  if (Array.isArray(r.stack)) {
    const seen = new Set<string>();
    out.stack = [];
    for (const s of r.stack) {
      if (typeof s !== "string") continue;
      const v = s.trim().slice(0, 40);
      if (!v || seen.has(v.toLowerCase())) continue;
      seen.add(v.toLowerCase());
      out.stack.push(v);
      if (out.stack.length >= MAX_STACK) break;
    }
  }
  if (CURRENCIES.includes(r.currency as DisplayCurrency)) out.currency = r.currency as DisplayCurrency;
  if (LANGUAGES.includes(r.language as UiLanguage)) out.language = r.language as UiLanguage;
  if (r.repo === null || (typeof r.repo === "string" && REPO_RE.test(r.repo))) out.repo = (r.repo as string | null) ?? null;
  if (typeof r.step === "number" && Number.isInteger(r.step)) out.step = Math.min(ONBOARDING_STEPS, Math.max(1, r.step));
  return out;
}

export type PatchResult = { ok: true; patch: ProfilePatch } | { ok: false; error: string };

/** Validates a POST /api/me/onboarding body. Unknown keys (incl. defaultMode, see U2) are ignored; bad values are refused. */
export function parseProfilePatch(body: unknown): PatchResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  const b = body as Record<string, unknown>;
  const patch: ProfilePatch = {};
  if (b.preferences !== undefined) {
    const p = b.preferences;
    if (!p || typeof p !== "object" || Array.isArray(p)) return { ok: false, error: "invalid_preferences" };
    const raw = p as Record<string, unknown>;
    const checks: [string, (v: unknown) => boolean][] = [
      ["role", (v) => v === null || ROLES.includes(v as OnboardingRole)],
      ["stack", (v) => Array.isArray(v) && v.every((s) => typeof s === "string")],
      ["currency", (v) => CURRENCIES.includes(v as DisplayCurrency)],
      ["language", (v) => LANGUAGES.includes(v as UiLanguage)],
      ["repo", (v) => v === null || (typeof v === "string" && REPO_RE.test(v))],
      ["step", (v) => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= ONBOARDING_STEPS],
    ];
    const prefs: Partial<Preferences> = {};
    for (const [key, ok] of checks) {
      if (raw[key] === undefined) continue;
      if (!ok(raw[key])) return { ok: false, error: `invalid_${key}` };
      (prefs as Record<string, unknown>)[key] = raw[key];
    }
    patch.preferences = prefs;
  }
  if (b.done !== undefined) {
    if (typeof b.done !== "boolean") return { ok: false, error: "invalid_done" };
    patch.done = b.done;
  }
  return { ok: true, patch };
}

/** Normalized `user@domain` or null (B6's LUD-16 parser). */
export function normalizeLightningAddress(value: unknown): string | null {
  const a = parseLightningAddress(value);
  return a ? `${a.user}@${a.domain}` : null;
}

/** Single process, in memory: tests and the offline demo (no DATABASE_URL). */
export class InMemoryProfileStore implements ProfileStore {
  private readonly rows = new Map<string, Profile>();
  constructor(private readonly now: () => Date = () => new Date()) {}

  async get(login: string): Promise<Profile> {
    const p = this.rows.get(login.toLowerCase());
    return p ? structuredClone(p) : { defaultMode: null, onboardedAt: null, preferences: { ...DEFAULT_PREFERENCES, stack: [] }, lightningAddress: null };
  }

  async update(login: string, patch: ProfilePatch): Promise<Profile> {
    const cur = await this.get(login);
    const next: Profile = {
      ...cur,
      preferences: patch.preferences ? normalizePreferences(patch.preferences, cur.preferences) : cur.preferences,
      onboardedAt: patch.done ? (cur.onboardedAt ?? this.now().toISOString()) : cur.onboardedAt,
    };
    this.rows.set(login.toLowerCase(), next);
    return structuredClone(next);
  }

  async setLightningAddress(login: string, address: string): Promise<void> {
    const cur = await this.get(login);
    this.rows.set(login.toLowerCase(), { ...cur, lightningAddress: address });
  }
}

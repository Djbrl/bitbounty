// Browser calls for the /me onboarding steps. Today they hit the mock /api/* (F4);
// I1 points the same URLs at the real server, nothing else changes.
import type { Me, PayoutProvider } from "../../../../fixtures/types";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; attemptsLeft?: number };

export interface OnboardingApi {
  /** Step 1: saves provider + number + name, sends the SMS code. */
  createAccount(input: { provider: PayoutProvider; phone: string; accountName: string; country: "SN" }): Promise<ApiResult<Me>>;
  /** Step 2: checks the SMS code, then the server sends the small test payout. */
  verifySms(code: string): Promise<ApiResult<Me>>;
  /** Step 3: the amount the developer says they received. */
  confirmAmount(amount: number): Promise<ApiResult<Me>>;
}

async function post<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`/api/me/payout-account${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return { ok: true, data: json as T };
    return {
      ok: false,
      status: res.status,
      error: typeof json.error === "string" ? json.error : "unknown_error",
      attemptsLeft: typeof json.attemptsLeft === "number" ? json.attemptsLeft : undefined,
    };
  } catch {
    return { ok: false, status: 0, error: "network_error" };
  }
}

export const onboardingApi: OnboardingApi = {
  createAccount: (input) => post<Me>("", input),
  verifySms: (code) => post<Me>("/sms", { code }),
  confirmAmount: (amount) => post<Me>("/confirm", { amount }),
};

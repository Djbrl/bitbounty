// U1: browser calls for /welcome. Same URL in fixtures mode (mock) and on the real server (proxy).
import type { OnboardingState, UserMode } from "../../../../fixtures/types";
import { postJson, type ApiResult } from "../onboarding/api";
import { saveWelcomeLang, saveWelcomeMode } from "./actions";

/** `defaultMode` is saved through U2's /api/me/mode (saveMode), not here. */
export type OnboardingPatch = {
  preferences?: Partial<OnboardingState["preferences"]>;
  done?: boolean;
};

export interface WelcomeApi {
  save(patch: OnboardingPatch): Promise<ApiResult<OnboardingState>>;
  /** U2: bb_mode cookie + users.default_mode. */
  saveMode(mode: UserMode): Promise<boolean>;
  /** bb_lang cookie (read by the /app shell). */
  saveLang(lang: "fr" | "en"): Promise<void>;
}

export const welcomeApi: WelcomeApi = {
  save: (patch) => postJson<OnboardingState>("/api/me/onboarding", patch),
  saveMode: (mode) => saveWelcomeMode(mode).catch(() => false),
  saveLang: (lang) => saveWelcomeLang(lang).catch(() => undefined),
};

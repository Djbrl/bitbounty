// U1: browser calls for /welcome. Same URL in fixtures mode (mock) and on the real server (proxy).
import type { OnboardingState } from "../../../../fixtures/types";
import { postJson, type ApiResult } from "../onboarding/api";
export type OnboardingPatch = {
  defaultMode?: OnboardingState["defaultMode"];
  preferences?: Partial<OnboardingState["preferences"]>;
  done?: boolean;
};

export interface WelcomeApi {
  save(patch: OnboardingPatch): Promise<ApiResult<OnboardingState>>;
}

export const welcomeApi: WelcomeApi = {
  save: (patch) => postJson<OnboardingState>("/api/me/onboarding", patch),
};


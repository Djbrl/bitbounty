// U1: server-side loader for /welcome (real server with the session user, else the fixtures mock).
import me from "../../../../fixtures/me.json";
import users from "../../../../fixtures/users.json";
import dashboard from "../../../../fixtures/dashboard.json";
import type { OnboardingState } from "../../../../fixtures/types";
import { load } from "../../lib/api";
import { handleMock, type Fixtures } from "../../lib/mock-api";
import { sessionLogin } from "../../lib/session-login";

const fx = { me, users, dashboard } as unknown as Fixtures;

/** The page's loader: GET /api/me/onboarding on the real server (session user), else the fixtures mock. */
export async function fetchOnboarding(): Promise<OnboardingState | null> {
  return load<OnboardingState>(
    "/api/me/onboarding",
    () => {
      const res = handleMock(fx, "GET", ["me", "onboarding"], new URLSearchParams());
      return "json" in res ? (res.json as OnboardingState) : null;
    },
    { user: await sessionLogin() },
  );
}

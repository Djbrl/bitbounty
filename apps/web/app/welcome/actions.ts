"use server";
// L1: finishing onboarding. Stores the chosen mode on the server (users.default_mode, onboarded_at
// stamped once), copies both fields into the session cookie so middleware sees them at once, then
// opens the workspace. U1's /welcome and the future /settings can call it with a `mode` field.
import { redirect } from "next/navigation";
import { savePreferences } from "../../lib/auth/preferences";
import { parseMode, WELCOME_PATH, workspacePath } from "../../lib/auth/workspace";
import { sessionUser } from "../../lib/session-login";

export async function completeOnboarding(formData: FormData): Promise<void> {
  const mode = parseMode(formData.get("mode"));
  if (!mode) redirect(WELCOME_PATH);
  const signedIn = await sessionUser();
  if (signedIn) {
    const saved = await savePreferences(signedIn.user.login, mode);
    const { unstable_update } = await import("../../auth");
    // No server (fixtures) or it failed: the session alone remembers it, until the next sign-in.
    await unstable_update({ user: saved ?? { defaultMode: mode, onboardedAt: signedIn.preferences.onboardedAt ?? new Date().toISOString() } });
  }
  redirect(workspacePath(mode));
}

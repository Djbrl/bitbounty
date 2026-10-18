// L1: every landing CTA links here. `/start?intent=maintain|hunt` (or no intent from "Se connecter"):
// signed out → straight to GitHub sign-in, back on /welcome?intent=… (or /app); signed in → the same
// place directly (middleware sends an onboarded user on to their workspace). Auth off → no sign-in.
import { redirect } from "next/navigation";
import { authEnabled } from "../../lib/auth/paths";
import { parseMode, startTarget } from "../../lib/auth/workspace";
import { sessionUser } from "../../lib/session-login";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const target = startTarget(parseMode(new URL(req.url).searchParams.get("intent")));
  if (!authEnabled() || (await sessionUser())) redirect(target);
  const { signIn } = await import("../../auth");
  // Sets Auth.js's state / PKCE / callback-url cookies and redirects to github.com/login/oauth/authorize.
  await signIn("github", { redirectTo: target });
}

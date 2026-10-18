// /signin/github?callbackUrl=<path>: starts the GitHub OAuth flow right away (no intermediate page).
// A route handler, not a page: signIn() sets the PKCE/state cookies, which a server component can't.
import { redirect } from "next/navigation";
import { signIn } from "../../../auth";
import { authEnabled, safeCallbackUrl, SIGN_IN_PATH } from "../../../lib/auth/paths";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<never> {
  const callbackUrl = safeCallbackUrl(new URL(req.url).searchParams.get("callbackUrl"));
  if (!authEnabled()) redirect(`${SIGN_IN_PATH}?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  return signIn("github", { redirectTo: callbackUrl }) as Promise<never>;
}

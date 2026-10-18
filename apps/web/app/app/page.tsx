import { redirect } from "next/navigation";
import { appHomePath, NOT_ONBOARDED } from "../../lib/auth/workspace";
import { sessionUser } from "../../lib/session-login";

export const dynamic = "force-dynamic";

/** `/app` → the user's default mode, or /welcome. Middleware does this first when auth is on; this covers auth off. */
export default async function AppHome() {
  redirect(appHomePath((await sessionUser())?.preferences ?? NOT_ONBOARDED));
}

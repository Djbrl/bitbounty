// W9: sign-in page. Middleware sends signed-out visitors of /dashboard and /me here,
// and Auth.js sends errors here too. L1: a cancel / refusal on GitHub (?error=OAuthCallbackError or
// AccessDenied) isn't an error for the visitor: they go back to the landing.
import { redirect } from "next/navigation";
import { UserMenu } from "../../components/auth";
import { authEnabled, isCancelledSignIn, safeCallbackUrl, signInErrorMessage } from "../../lib/auth/paths";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ callbackUrl?: string | string[]; error?: string | string[] }>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  if (isCancelledSignIn(first(sp.error))) redirect("/");
  const callbackUrl = safeCallbackUrl(first(sp.callbackUrl));
  const error = signInErrorMessage(first(sp.error));

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-16">
      <h1 className="text-2xl font-semibold">Sign in to BitBounty</h1>
      <p className="text-sm text-neutral-600">We use your GitHub account to know who claims and who gets paid.</p>
      {error ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {authEnabled() ? (
        <UserMenu redirectTo={callbackUrl} />
      ) : (
        <p className="text-sm text-neutral-600">
          Sign-in is off: <code>AUTH_SECRET</code> is not set, so every page is public. See docs/auth.md.
        </p>
      )}
    </main>
  );
}

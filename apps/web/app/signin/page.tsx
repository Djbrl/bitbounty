// W9: sign-in. Middleware sends signed-out visitors of protected pages here with ?callbackUrl=.
// Auth on: goes straight to GitHub (via /signin/github, which sets the OAuth cookies), or straight back
// to callbackUrl when already signed in. Only errors (?error=AccessDenied...) and "auth off" render a page.
import { redirect } from "next/navigation";
import { authEnabled, safeCallbackUrl, signInErrorMessage } from "../../lib/auth/paths";
import { sessionLogin } from "../../lib/session-login";
import { buttonClass } from "../../components/ui/button";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ callbackUrl?: string | string[]; error?: string | string[] }>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function githubStartHref(callbackUrl: string): string {
  return `/signin/github?callbackUrl=${encodeURIComponent(safeCallbackUrl(callbackUrl))}`;
}

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const callbackUrl = safeCallbackUrl(first(sp.callbackUrl));
  const error = signInErrorMessage(first(sp.error));
  const on = authEnabled();

  // No error to show: never stop on this page.
  if (on && !error) {
    if (await sessionLogin()) redirect(callbackUrl);
    redirect(githubStartHref(callbackUrl));
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-16">
      <h1 className="text-2xl">Connexion à BitBounty · Sign in</h1>
      {error ? (
        <p role="alert" className="rounded-[10px] bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      {on ? (
        <a href={githubStartHref(callbackUrl)} className={buttonClass({ variant: "dark" })}>
          Réessayer avec GitHub · Try again with GitHub
        </a>
      ) : (
        <p className="text-sm text-muted">
          Connexion désactivée : <code>AUTH_SECRET</code> n&apos;est pas défini, toutes les pages sont publiques. Sign-in is off (no{" "}
          <code>AUTH_SECRET</code>), every page is public. See docs/auth.md.
        </p>
      )}
    </main>
  );
}

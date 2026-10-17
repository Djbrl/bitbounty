"use client";

// I1: any page whose data can't be loaded (server down, too slow, 5xx) lands here instead of a blank 500.
// A 401/403 (session missing or expired, token mismatch) gets its own message and a sign-in action.
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Button, buttonClass } from "@/components/ui";
import { ErrorState } from "@/components/ui/states";
import { errorText, isAuthError } from "@/lib/api";
import { signInHref } from "@/lib/auth/paths";

export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const pathname = usePathname();
  useEffect(() => {
    console.error(error);
  }, [error]);
  if (isAuthError(error)) {
    return (
      <ErrorState
        title="Connexion requise"
        message={errorText(error)}
        action={
          <div className="flex flex-wrap gap-2">
            {/* Full navigation, not <Link>: the sign-in flow leaves the app for GitHub. */}
            <a href={signInHref(pathname)} className={buttonClass({})}>
              Se reconnecter avec GitHub
            </a>
            <Button variant="secondary" onClick={reset}>
              Réessayer
            </Button>
          </div>
        }
      />
    );
  }
  return (
    <ErrorState
      message={errorText(error)}
      action={
        <div>
          <Button onClick={reset}>Réessayer</Button>
        </div>
      }
    />
  );
}

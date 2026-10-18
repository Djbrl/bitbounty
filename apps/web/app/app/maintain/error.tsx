"use client";
// U4: the maintainer home couldn't load (server down, session expired). The shell stays in place.
import { Button, buttonClass, Card } from "@/components/ui";
import { errorText, isAuthError } from "@/lib/api";
import { signInHref } from "@/lib/auth/paths";

export default function MaintainError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const auth = isAuthError(error);
  return (
    <Card emphasis role="alert" className="grid max-w-xl gap-3">
      <h1 className="text-xl font-semibold">{auth ? "Connexion requise" : "Impossible de charger l'espace maintainer"}</h1>
      <p className="text-ink-soft">{errorText(error)}</p>
      <div className="flex flex-wrap gap-2">
        {auth ? (
          <a href={signInHref("/app/maintain")} className={buttonClass({})}>
            Se reconnecter avec GitHub
          </a>
        ) : null}
        <Button variant="secondary" onClick={reset}>
          Réessayer
        </Button>
      </div>
    </Card>
  );
}

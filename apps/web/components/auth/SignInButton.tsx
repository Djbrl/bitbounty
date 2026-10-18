// W9: "Sign in with GitHub" (server component + server action, works without client JS).
import { signIn } from "../../auth";
import { safeCallbackUrl } from "../../lib/auth/paths";
import { buttonClass } from "../ui/button";

export function SignInButton({ redirectTo = "/", className }: { redirectTo?: string; className?: string }) {
  const target = safeCallbackUrl(redirectTo);
  return (
    <form
      action={async () => {
        "use server";
        await signIn("github", { redirectTo: target });
      }}
    >
      <button
        type="submit"
        className={className ?? buttonClass({ variant: "dark" })}
      >
        Sign in with GitHub
      </button>
    </form>
  );
}

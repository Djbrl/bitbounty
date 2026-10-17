// W9: "Sign in with GitHub" (server component + server action, works without client JS).
import { signIn } from "../../auth";
import { safeCallbackUrl } from "../../lib/auth/paths";

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
        className={className ?? "rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"}
      >
        Sign in with GitHub
      </button>
    </form>
  );
}

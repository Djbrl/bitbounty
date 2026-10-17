// W9: sign out (clears the session cookie) and go back to the home page.
import { signOut } from "../../auth";

export function SignOutButton({ className }: { className?: string }) {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
    >
      <button type="submit" className={className ?? "text-sm text-neutral-600 underline hover:text-neutral-900"}>
        Sign out
      </button>
    </form>
  );
}

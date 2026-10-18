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
      <button type="submit" className={className ?? "text-sm text-muted underline hover:text-ink"}>
        Sign out
      </button>
    </form>
  );
}

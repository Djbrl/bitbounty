// W9: avatar + @login + sign out when signed in, "Sign in with GitHub" otherwise.
// Drop it in any server component (e.g. the header W1 builds). Renders nothing when auth is off.
import { auth } from "../../auth";
import { authEnabled } from "../../lib/auth/paths";
import { sessionToUser } from "../../lib/auth/session-user";
import { SignInButton } from "./SignInButton";
import { SignOutButton } from "./SignOutButton";

export async function UserMenu({ redirectTo }: { redirectTo?: string }) {
  if (!authEnabled()) return null;
  const user = sessionToUser(await auth());
  if (!user) return <SignInButton redirectTo={redirectTo} />;
  return (
    <div className="flex items-center gap-3">
      {user.avatarUrl ? (
        <img src={user.avatarUrl} alt="" width={32} height={32} className="h-8 w-8 rounded-full" />
      ) : null}
      <a href={`https://github.com/${user.login}`} className="text-sm font-medium">
        @{user.login}
      </a>
      <SignOutButton />
    </div>
  );
}

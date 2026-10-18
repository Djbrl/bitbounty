// W9: Auth.js v5 config. Sign in with GitHub through the "BitBounty Dakar" GitHub App
// (GitHub Apps support user OAuth). See docs/auth.md.
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { SIGN_IN_PATH } from "./lib/auth/paths";
import { fetchPreferences } from "./lib/auth/preferences";
import { githubProfileToSessionUser, sessionUserFromToken } from "./lib/auth/session-user";
import { preferencesFrom } from "./lib/auth/workspace";

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  // Reads AUTH_GITHUB_ID / AUTH_GITHUB_SECRET; AUTH_SECRET signs the session cookie.
  providers: [GitHub],
  // Stateless JWT cookie: no DB needed. Expired session = signed out, middleware sends you to /signin.
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
  // Our page handles both the sign-in button and errors (?error=AccessDenied, OAuthCallbackError...).
  pages: { signIn: SIGN_IN_PATH, error: SIGN_IN_PATH },
  callbacks: {
    // `profile` is only present right after the GitHub callback: store the User fields in the token,
    // plus the L1 onboarding fields the server remembers (a returning user skips /welcome).
    async jwt({ token, profile, trigger, session }) {
      if (profile) {
        const user = githubProfileToSessionUser(profile);
        if (!user) throw new Error("GitHub profile is missing id or login");
        Object.assign(token, user, await fetchPreferences(user.login));
      }
      // L1: /welcome calls unstable_update({ user: { defaultMode, onboardedAt } }). Only those two
      // fields are taken (validated), never the identity.
      if (trigger === "update") {
        const next = preferencesFrom(session?.user);
        if (next.defaultMode) Object.assign(token, next);
      }
      return token;
    },
    // Expose githubId / login / avatarUrl (mirrors `User` in packages/core) and defaultMode / onboardedAt on session.user.
    session({ session, token }) {
      const user = sessionUserFromToken(token);
      if (user) Object.assign(session.user, user, preferencesFrom(token));
      return session;
    },
  },
});

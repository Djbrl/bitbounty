// W9: Auth.js v5 config. Sign in with GitHub through the "BitBounty Dakar" GitHub App
// (GitHub Apps support user OAuth). See docs/auth.md.
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { SIGN_IN_PATH } from "./lib/auth/paths";
import { githubProfileToSessionUser, sessionUserFromToken } from "./lib/auth/session-user";

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Reads AUTH_GITHUB_ID / AUTH_GITHUB_SECRET; AUTH_SECRET signs the session cookie.
  providers: [GitHub],
  // Stateless JWT cookie: no DB needed. Expired session = signed out, middleware sends you to /signin.
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
  // Our page handles both the sign-in button and errors (?error=AccessDenied, OAuthCallbackError...).
  pages: { signIn: SIGN_IN_PATH, error: SIGN_IN_PATH },
  callbacks: {
    // `profile` is only present right after the GitHub callback: store the User fields in the token.
    jwt({ token, profile }) {
      if (profile) {
        const user = githubProfileToSessionUser(profile);
        if (!user) throw new Error("GitHub profile is missing id or login");
        Object.assign(token, user);
      }
      return token;
    },
    // Expose githubId / login / avatarUrl on session.user (mirrors `User` in packages/core).
    session({ session, token }) {
      const user = sessionUserFromToken(token);
      if (user) Object.assign(session.user, user);
      return session;
    },
  },
});

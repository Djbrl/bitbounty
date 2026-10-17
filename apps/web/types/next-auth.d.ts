// W9: the session carries the GitHub identity (see lib/auth/session-user.ts).
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      githubId?: number;
      login?: string;
      avatarUrl?: string | null;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    githubId?: number;
    login?: string;
    avatarUrl?: string | null;
  }
}

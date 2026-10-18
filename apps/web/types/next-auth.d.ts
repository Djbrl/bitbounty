// W9: the session carries the GitHub identity (see lib/auth/session-user.ts).
// L1: plus the onboarding fields (see lib/auth/workspace.ts).
import type { WorkspaceMode } from "@bitbounty/core";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      githubId?: number;
      login?: string;
      avatarUrl?: string | null;
      defaultMode?: WorkspaceMode | null;
      onboardedAt?: string | null;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    githubId?: number;
    login?: string;
    avatarUrl?: string | null;
    defaultMode?: WorkspaceMode | null;
    onboardedAt?: string | null;
  }
}

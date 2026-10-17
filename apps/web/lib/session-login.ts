// Server only: the signed-in GitHub login, for calls the server answers per user (/api/me, /api/dashboard).
import { authEnabled } from "./auth/paths";
import { sessionToUser } from "./auth/session-user";

export async function sessionLogin(): Promise<string | null> {
  if (!authEnabled()) return null;
  try {
    const { auth } = await import("../auth");
    return sessionToUser(await auth())?.login ?? null;
  } catch {
    return null;
  }
}

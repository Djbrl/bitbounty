// Server-side loader for /me: same answer as `GET /api/me?state=…`, computed in-process so
// `next build` needs no running server. I1 swaps the body for a call to the real API (session user).
import me from "../../../../fixtures/me.json";
import type { Me } from "../../../../fixtures/types";
import { ApiError, load } from "../../lib/api";
import { handleMock, type Fixtures } from "../../lib/mock-api";
import { sessionLogin } from "../../lib/session-login";
import type { MeState } from "./logic";

export function loadMe(state?: MeState): Me {
  const query = new URLSearchParams(state ? { state } : {});
  const res = handleMock({ me } as unknown as Fixtures, "GET", ["me"], query);
  if (!("json" in res) || res.status !== 200) throw new Error(`GET /api/me failed (${res.status})`);
  return res.json as Me;
}

/** The page's loader: GET /api/me on the real server (needs the session), otherwise the fixture states. */
export async function fetchMe(state?: MeState): Promise<Me> {
  const me = await load<Me>("/api/me", () => loadMe(state), { user: await sessionLogin() });
  if (!me) throw new ApiError(404, "me_not_found");
  return me;
}

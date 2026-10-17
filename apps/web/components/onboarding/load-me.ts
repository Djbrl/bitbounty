// Server-side loader for /me: same answer as `GET /api/me?state=…`, computed in-process so
// `next build` needs no running server. I1 swaps the body for a call to the real API (session user).
import me from "../../../../fixtures/me.json";
import type { Me } from "../../../../fixtures/types";
import { handleMock, type Fixtures } from "../../lib/mock-api";
import type { MeState } from "./logic";

export function loadMe(state?: MeState): Me {
  const query = new URLSearchParams(state ? { state } : {});
  const res = handleMock({ me } as unknown as Fixtures, "GET", ["me"], query);
  if (!("json" in res) || res.status !== 200) throw new Error(`GET /api/me failed (${res.status})`);
  return res.json as Me;
}

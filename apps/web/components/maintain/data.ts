// U4: server-side data for /app/maintain. Real server (GET /api/maintain) or the fixtures.
import { cookies } from "next/headers";
import bounties from "../../../../fixtures/bounties.json";
import dashboard from "../../../../fixtures/dashboard.json";
import type { BountyDetail, Dashboard } from "../../../../fixtures/types";
import { load } from "../../lib/api";
import { sessionLogin } from "../../lib/session-login";
import { LANG_COOKIE, parseLang, type Lang } from "../app-shell/mode";
import { mockHome, type MaintainHome } from "./shape";

export async function getMaintainHome(): Promise<MaintainHome> {
  const data = await load<MaintainHome>(
    "/api/maintain",
    () => mockHome(bounties as unknown as BountyDetail[], dashboard as unknown as Dashboard),
    { user: await sessionLogin() },
  );
  if (!data) throw new Error("maintain_unavailable");
  return data;
}

export async function getLang(): Promise<Lang> {
  return parseLang((await cookies()).get(LANG_COOKIE)?.value);
}

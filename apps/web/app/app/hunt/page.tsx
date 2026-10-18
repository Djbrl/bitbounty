// U3: Hunter home inside the app shell (U2): hunter card, tier progress, claims, bounties for you, activity, earnings.
import type { Metadata } from "next";
import { LANG_COOKIE, parseLang } from "@/components/app-shell/mode";
import { loadHunt, readCookie } from "@/components/hunt/data";
import { HuntView } from "@/components/hunt/hunt-view";

export const metadata: Metadata = { title: "Hunter · BitBounty" };
export const dynamic = "force-dynamic";

export default async function HuntHome() {
  const now = new Date();
  const [data, lang] = await Promise.all([loadHunt(now), readCookie(LANG_COOKIE)]);
  return <HuntView data={data} lang={parseLang(lang)} now={now.getTime()} />;
}

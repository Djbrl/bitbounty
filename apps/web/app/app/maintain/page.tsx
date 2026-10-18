// U4: Maintainer home inside the app shell: what needs a decision now, money in play, repos, payouts.
import type { Metadata } from "next";
import { decideBounty, suggestBacklog } from "@/components/maintain/actions";
import { getLang, getMaintainHome } from "@/components/maintain/data";
import { MaintainView } from "@/components/maintain/maintain-view";

export const metadata: Metadata = { title: "Maintainer · BitBounty" };
export const dynamic = "force-dynamic";

export default async function MaintainHome() {
  const [data, lang] = await Promise.all([getMaintainHome(), getLang()]);
  return <MaintainView data={data} lang={lang} decide={decideBounty} suggest={suggestBacklog} />;
}

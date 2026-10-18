// Maintainer stats (moved off the home): money summary and agent budgets.
import type { Metadata } from "next";
import { getLang, getMaintainHome } from "@/components/maintain/data";
import { MaintainAgents, MaintainStats, SectionPage } from "@/components/maintain/sections";
import { maintainText } from "@/components/maintain/shape";

export const metadata: Metadata = { title: "Stats · BitBounty" };
export const dynamic = "force-dynamic";

export default async function MaintainStatsPage() {
  const [data, lang] = await Promise.all([getMaintainHome(), getLang()]);
  const t = maintainText(lang);
  return (
    <SectionPage lang={lang} title={t.stats}>
      <p className="max-w-[68ch] text-muted">{t.statsDesc}</p>
      <MaintainStats data={data} lang={lang} />
      <MaintainAgents data={data} lang={lang} />
    </SectionPage>
  );
}

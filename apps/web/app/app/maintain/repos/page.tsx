// Maintainer repos (moved off the home): installed repos, open bounties, paid count.
import type { Metadata } from "next";
import { getLang, getMaintainHome } from "@/components/maintain/data";
import { MaintainRepos, SectionPage } from "@/components/maintain/sections";
import { maintainText } from "@/components/maintain/shape";

export const metadata: Metadata = { title: "Repos · BitBounty" };
export const dynamic = "force-dynamic";

export default async function MaintainReposPage() {
  const [data, lang] = await Promise.all([getMaintainHome(), getLang()]);
  return (
    <SectionPage lang={lang} title={maintainText(lang).repos}>
      <MaintainRepos data={data} lang={lang} />
    </SectionPage>
  );
}

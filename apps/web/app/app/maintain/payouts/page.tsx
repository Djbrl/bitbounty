// Maintainer payouts (moved off the home): paying / paid / failed, with receipts.
import type { Metadata } from "next";
import { getLang, getMaintainHome } from "@/components/maintain/data";
import { MaintainPayouts, SectionPage } from "@/components/maintain/sections";
import { maintainText } from "@/components/maintain/shape";

export const metadata: Metadata = { title: "Payouts · BitBounty" };
export const dynamic = "force-dynamic";

export default async function MaintainPayoutsPage() {
  const [data, lang] = await Promise.all([getMaintainHome(), getLang()]);
  return (
    <SectionPage lang={lang} title={maintainText(lang).payouts}>
      <MaintainPayouts data={data} lang={lang} />
    </SectionPage>
  );
}

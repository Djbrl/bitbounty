import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Page } from "@/components/ui";
import { fetchFundBounty } from "@/components/fund/data";
import { FundView } from "@/components/fund/fund-view";

type Props = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const bounty = await fetchFundBounty((await params).id);
  return { title: bounty ? `Fund ${bounty.repoFullName} #${bounty.issueNumber} · BitBounty` : "Fund · BitBounty" };
}

/** /pay/[id]: opened from the bot's "Fund this bounty" link. Methods left, order summary right. */
export default async function FundPage({ params }: Props) {
  const bounty = await fetchFundBounty((await params).id);
  if (!bounty) notFound();
  return (
    <Page
      nav={{
        items: [
          { href: "/explore", label: "Board" },
          { href: "/dashboard", label: "Dashboard" },
        ],
        initials: bounty.funderLogin.slice(0, 2),
      }}
    >
      <FundView bounty={bounty} />
    </Page>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BOUNTY_NAV, BountyView } from "@/components/bounty/bounty-view";
import { getBounty, receiptIdForBounty } from "@/components/bounty/data";
import { formatXof, Page } from "@/components/ui";

type Props = { params: Promise<{ id: string }> };

// Rendered per request: the data comes from the server (I1), never baked in at build time.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const b = await getBounty((await params).id);
  if (!b) return { title: "Bounty not found · BitBounty" };
  return {
    title: `${formatXof(b.amountXof)} · ${b.repoFullName}#${b.issueNumber} · BitBounty`,
    description: b.issueTitle,
  };
}

export default async function BountyPage({ params }: Props) {
  const { id } = await params;
  const b = await getBounty(id);
  if (!b) notFound();
  const receiptId = await receiptIdForBounty(b.id);
  return (
    <Page nav={BOUNTY_NAV}>
      <BountyView b={b} receiptId={receiptId} />
    </Page>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getReceipt, receiptIds } from "@/components/bounty/data";
import { ReceiptView } from "@/components/bounty/receipt-view";
import { formatDuration, PROVIDER_LABEL } from "@/components/bounty/shape";
import { formatXof, Mark, Page } from "@/components/ui";

type Props = { params: Promise<{ id: string }> };

export function generateStaticParams() {
  return receiptIds().map((id) => ({ id }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = await getReceipt((await params).id);
  if (!r) return { title: "Reçu introuvable · BitBounty" };
  const title = `+${formatXof(r.amountXof)} pour @${r.recipientLogin} · BitBounty`;
  const description = `${r.repoFullName} #${r.issueNumber} payé sur ${PROVIDER_LABEL[r.provider]}, ${formatDuration(r.minutesMergeToPay)} après le merge.`;
  return { title, description, openGraph: { title, description } };
}

export default async function ReceiptPage({ params }: Props) {
  const { id } = await params;
  const r = await getReceipt(id);
  if (!r) notFound();
  return (
    <Page width="narrow">
      <div className="grid gap-6">
        <div className="grid justify-items-center gap-2 text-center">
          <Link href="/" aria-label="BitBounty">
            <Mark />
          </Link>
          <p className="text-sm text-muted">
            Envoyé à <b className="text-ink">@{r.recipientLogin}</b> sur {PROVIDER_LABEL[r.provider]} ·{" "}
            <b className="text-ink">{formatDuration(r.minutesMergeToPay)}</b> après le merge.
          </p>
        </div>
        <ReceiptView r={r} />
      </div>
    </Page>
  );
}

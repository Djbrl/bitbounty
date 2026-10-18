import Link from "next/link";
import { buttonClass, Card, Page } from "@/components/ui";

export default function ReceiptNotFound() {
  return (
    <Page width="narrow">
      <Card padding="lg" className="grid gap-3 text-center">
        <h1 className="text-2xl font-extrabold">Reçu introuvable</h1>
        <p className="text-muted">Ce reçu n&apos;existe pas, ou le lien est incorrect.</p>
        <Link href="/explore" className={buttonClass({ className: "justify-self-center" })}>
          Voir les bounties
        </Link>
      </Card>
    </Page>
  );
}

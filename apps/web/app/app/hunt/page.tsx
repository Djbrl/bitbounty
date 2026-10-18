import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass, Card, Eyebrow, Page } from "../../../components/ui";

export const metadata: Metadata = { title: "Espace développeur · BitBounty" };

/** L1 PLACEHOLDER for the hunter home (U2 builds the /app shell, U3/U4 the homes). */
export default function HuntHome() {
  return (
    <Page width="narrow" nav={{ items: [{ href: "/explore", label: "Bounties" }, { href: "/app/maintain", label: "Mode mainteneur" }] }}>
      <Card padding="lg" className="grid gap-4" lang="fr">
        <Eyebrow>Espace développeur · bientôt</Eyebrow>
        <h1 className="font-display text-2xl font-extrabold">Trouve une issue payée</h1>
        <p className="text-muted">Relie ton compte Wave ou Orange Money une fois, puis réclame une issue avec /claim.</p>
        <div className="grid gap-2">
          <Link href="/explore" className={buttonClass({ size: "lg", block: true })}>
            Voir les issues payées
          </Link>
          <Link href="/me" className={buttonClass({ variant: "secondary", size: "lg", block: true })}>
            Mon compte de paiement
          </Link>
        </div>
      </Card>
    </Page>
  );
}

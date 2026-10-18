import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass, Card, Eyebrow, Page } from "../../../components/ui";

export const metadata: Metadata = { title: "Espace mainteneur · BitBounty" };

/** L1 PLACEHOLDER for the maintainer home (U2 builds the /app shell, U3/U4 the homes). */
export default function MaintainHome() {
  return (
    <Page width="narrow" nav={{ items: [{ href: "/explore", label: "Bounties" }, { href: "/app/hunt", label: "Mode développeur" }] }}>
      <Card padding="lg" className="grid gap-4" lang="fr">
        <Eyebrow>Espace mainteneur · bientôt</Eyebrow>
        <h1 className="font-display text-2xl font-extrabold">Finance ton backlog</h1>
        <p className="text-muted">Installe l&apos;app GitHub sur ton dépôt, puis commente /bounty 10000 sur une issue.</p>
        <div className="grid gap-2">
          <Link href="/dashboard" className={buttonClass({ size: "lg", block: true })}>
            Mon tableau de bord
          </Link>
          <a href="https://github.com/apps/bitbounty-dakar" className={buttonClass({ variant: "secondary", size: "lg", block: true })}>
            Installer l&apos;app GitHub
          </a>
        </div>
      </Card>
    </Page>
  );
}

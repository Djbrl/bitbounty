// L1: placeholder for the onboarding (U1 builds the real one). The landing CTAs land here after GitHub
// sign-in (middleware protects /welcome) with ?intent=maintain|hunt; we point to the matching workspace.
import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass, Card, Page } from "@/components/ui";
import { parseIntent } from "./intent";

export const metadata: Metadata = { title: "Bienvenue · BitBounty" };

type SearchParams = Promise<{ intent?: string | string[] }>;

const CHOICES = {
  maintain: { href: "/dashboard", title: "Financer des issues", body: "Installez l'app GitHub, chiffrez votre backlog et financez une issue." },
  hunt: { href: "/me", title: "Être payé pour corriger", body: "Reliez votre compte Wave ou Orange Money, puis choisissez une issue payée." },
} as const;

export default async function WelcomePage({ searchParams }: { searchParams: SearchParams }) {
  const intent = parseIntent((await searchParams).intent);
  const order = intent === "maintain" ? (["maintain", "hunt"] as const) : (["hunt", "maintain"] as const);
  return (
    <Page width="narrow" nav={{ items: [{ href: "/explore", label: "Bounties" }, { href: "/live", label: "Live" }] }}>
      <section className="grid gap-4">
        <h1 className="font-display text-3xl font-extrabold">Bienvenue sur BitBounty</h1>
        <p className="text-muted">Un seul compte GitHub : vous pouvez financer sur un dépôt et corriger sur un autre.</p>
        {order.map((key, i) => {
          const c = CHOICES[key];
          return (
            <Card key={key} padding="lg" className="grid gap-3" data-intent={key}>
              <h2 className="font-display text-xl font-bold">{c.title}</h2>
              <p className="text-muted">{c.body}</p>
              <Link href={c.href} className={buttonClass({ variant: i === 0 ? undefined : "secondary", className: "justify-self-start" })}>
                Continuer
              </Link>
            </Card>
          );
        })}
        <Link href="/explore" className="text-sm underline">
          Voir les issues payées
        </Link>
      </section>
    </Page>
  );
}

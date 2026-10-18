import type { Metadata } from "next";
import { buttonClass, Card, Eyebrow, Page } from "../../components/ui";
import { parseMode } from "../../lib/auth/workspace";
import { sessionUser } from "../../lib/session-login";
import { completeOnboarding } from "./actions";

export const metadata: Metadata = { title: "Bienvenue · BitBounty" };
export const dynamic = "force-dynamic";

const CHOICES = [
  { mode: "maintain", label: "Financer des issues", hint: "Je maintiens un dépôt" },
  { mode: "hunt", label: "Être payé pour corriger", hint: "Je contribue" },
] as const;

type Props = { searchParams?: Promise<{ intent?: string | string[] }> };

/**
 * L1 PLACEHOLDER: U1 builds the real onboarding here. Landing CTAs arrive with ?intent=maintain|hunt
 * (that choice comes first); middleware sends already-onboarded users to their workspace.
 */
export default async function WelcomePage({ searchParams }: Props) {
  const raw = (await searchParams)?.intent;
  const intent = parseMode(Array.isArray(raw) ? raw[0] : raw);
  const login = (await sessionUser())?.user.login;
  const choices = intent === "hunt" ? [...CHOICES].reverse() : CHOICES;
  return (
    <Page width="narrow">
      <Card padding="lg" className="grid gap-4" lang="fr">
        <Eyebrow>Bienvenue</Eyebrow>
        <h1 className="font-display text-2xl font-extrabold">{login ? `Bienvenue, @${login}` : "Bienvenue sur BitBounty"}</h1>
        <p className="text-muted">Par où commencer ? C&apos;est le même compte GitHub pour les deux : tu pourras changer plus tard.</p>
        <form action={completeOnboarding} className="grid gap-2">
          {choices.map((c, i) => (
            <button
              key={c.mode}
              type="submit"
              name="mode"
              value={c.mode}
              className={buttonClass({ variant: i === 0 ? "primary" : "secondary", size: "lg", block: true })}
            >
              {c.label} · <span className="font-normal">{c.hint}</span>
            </button>
          ))}
        </form>
      </Card>
    </Page>
  );
}

// U1: onboarding after GitHub sign-in (middleware protects /welcome). Landing CTAs add ?intent=maintain|hunt.
// 3 steps (role · preferences · setup); ?step= and the server keep the step, so a reload resumes.
// Already onboarded → /app (U2 picks /app/hunt or /app/maintain).
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ErrorState, Page } from "@/components/ui";
import { fetchOnboarding } from "@/components/welcome/load";
import { APP_HREF, initialStep } from "@/components/welcome/logic";
import { WelcomeFlow } from "@/components/welcome/welcome-flow";
import { errorText } from "@/lib/api";
import { parseIntent } from "./intent";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bienvenue · BitBounty" };

type SearchParams = Promise<{ intent?: string | string[]; step?: string | string[]; again?: string | string[] }>;

export default async function WelcomePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const intent = parseIntent(params.intent);
  let state;
  try {
    state = await fetchOnboarding();
  } catch (err) {
    return <ErrorState title="Impossible de charger l'accueil" message={errorText(err)} />;
  }
  if (!state) redirect(APP_HREF);
  if (state.onboardedAt && !params.again) redirect(APP_HREF);
  return (
    <Page width="default" nav={{ items: [{ href: "/explore", label: "Bounties" }] }}>
      <WelcomeFlow initial={state} intent={intent} step={initialStep(params.step, state.preferences.step)} />
    </Page>
  );
}

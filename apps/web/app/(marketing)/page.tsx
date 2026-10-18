import type { Metadata, Viewport } from "next";
import { landingConfig } from "../../components/landing/config";
import { Landing } from "../../components/landing/landing";
import { sessionUser } from "../../lib/session-login";

export const metadata: Metadata = {
  title: "BitBounty · Faites-vous payer pour contribuer.",
  description:
    "Des issues GitHub payées pour les développeurs d'Afrique de l'Ouest. Les mainteneurs financent en sats, les développeurs sont payés en FCFA sur Wave quelques minutes après le merge. Propulsé par Bitnob.",
  openGraph: {
    title: "BitBounty · Faites-vous payer pour contribuer.",
    description: "Des issues GitHub payées, en FCFA, sur Wave. Propulsé par Bitnob.",
  },
  icons: { icon: { url: "/landing/favicon.svg", type: "image/svg+xml" } },
};

export const viewport: Viewport = { themeColor: "#0B1F17", viewportFit: "cover" };

// Per request: the CTAs depend on the session, and the trailer id is read from the environment.
export const dynamic = "force-dynamic";

/** `/`: the landing. Signed out: "Financer une issue" / "Être payé pour corriger"; signed in: "Ouvrir l'app". */
export default async function LandingPage() {
  return <Landing signedIn={(await sessionUser()) !== null} config={landingConfig()} />;
}

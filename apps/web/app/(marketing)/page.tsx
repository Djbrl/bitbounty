// L1: the public landing at `/` (ported from Djbrl/bitbounty-landing, French). The board moved to /explore.
// Static page: the markup is trusted, generated from the landing repo; the scroll story runs client side.
import type { Metadata } from "next";
import "./landing.css";
import { landingMarkup } from "./landing-markup";
import { LandingScroll } from "./landing-scroll";

export const metadata: Metadata = {
  title: "BitBounty · Faites-vous payer pour contribuer.",
  description:
    "Des issues GitHub payées pour les développeurs d'Afrique de l'Ouest. Les mainteneurs financent en sats, les développeurs sont payés en sats sur leur Lightning Address quelques minutes après le merge. Propulsé par Bitnob.",
  openGraph: {
    title: "BitBounty · Faites-vous payer pour contribuer.",
    description: "Des issues GitHub payées en sats, sur Lightning. Propulsé par Bitnob.",
  },
};

export default function LandingPage() {
  return (
    <>
      <div className="bb-landing" lang="fr" dangerouslySetInnerHTML={{ __html: landingMarkup() }} />
      <LandingScroll />
    </>
  );
}

// Shown for every page while MAINTENANCE_MODE is on (middleware rewrites to here), see lib/maintenance.ts.
import type { Metadata } from "next";
import { WaitlistForm } from "@/components/maintenance/waitlist-form";
import { Card } from "@/components/ui/card";
import { BACK_ON, CONTACT_EMAIL, FLY_URL } from "@/lib/maintenance";

export const metadata: Metadata = {
  title: `BitBounty · De retour le ${BACK_ON.fr}`,
  description: `BitBounty déménage sur Fly.io et revient le ${BACK_ON.fr}. Rejoignez la liste d'attente.`,
  robots: { index: false },
};

const link = "font-semibold text-money underline underline-offset-2 hover:text-money-strong";

export default function MaintenancePage() {
  return (
    <main lang="fr" className="mx-auto grid min-h-screen w-full max-w-xl content-center gap-6 px-4 py-12">
      <a href="/maintenance" className="flex items-center gap-2 text-[17px] font-bold" aria-label="BitBounty">
        <svg width="20" height="20" viewBox="0 0 30 30" aria-hidden="true">
          <path d="M8 4v22" stroke="currentColor" strokeWidth="2.8" fill="none" strokeLinecap="round" />
          <path d="M8 9c0 6 4 9 10.5 9.5" stroke="currentColor" strokeWidth="2.8" fill="none" strokeLinecap="round" />
          <circle cx="21.5" cy="18.5" r="5.2" className="fill-money" />
        </svg>
        BitBounty
      </a>

      <div className="grid gap-3">
        <h1 className="text-[2.4rem] leading-[1.05] sm:text-5xl">De retour le {BACK_ON.fr}.</h1>
        <p className="text-base text-ink-soft">
          BitBounty déménage&nbsp;: nous quittons notre serveur maison (Docker) pour un hébergement sur{" "}
          <a href={FLY_URL} target="_blank" rel="noopener noreferrer" className={link}>
            Fly.io
          </a>
          . Le site et le bot GitHub sont en pause pendant la migration.
        </p>
      </div>

      <Card padding="lg" className="grid gap-3">
        <p className="font-semibold">En attendant, rejoignez la liste d&apos;attente&nbsp;: on vous écrit dès que c&apos;est en ligne.</p>
        <WaitlistForm contactEmail={CONTACT_EMAIL} />
      </Card>

      {CONTACT_EMAIL && (
        <p className="text-sm text-ink-soft">
          Une question&nbsp;?{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className={link}>
            Écrivez-nous
          </a>
          .
        </p>
      )}

      <p lang="en" className="border-t border-rule pt-4 text-xs text-muted">
        BitBounty is moving to Fly.io and will be back on {BACK_ON.en}. Join the waitlist above
        {CONTACT_EMAIL ? (
          <>
            {" "}or <a href={`mailto:${CONTACT_EMAIL}`} className="underline">email us</a>
          </>
        ) : null}
        .
      </p>
    </main>
  );
}

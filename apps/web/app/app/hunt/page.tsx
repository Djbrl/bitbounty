// U2: Hunter home inside the app shell. Placeholder on the /me data (claims, earnings); U3 redesigns it.
import type { Metadata } from "next";
import Link from "next/link";
import { fetchMe } from "@/components/onboarding/load-me";
import { Card, EmptyState, Pill, Section, StatCard, buttonClass, formatXof } from "@/components/ui";

export const metadata: Metadata = { title: "Hunter · BitBounty" };
export const dynamic = "force-dynamic";

const PAYOUT_LABEL = { pending: "En attente", processing: "En cours", succeeded: "Payé", failed: "Échoué" } as const;
const PAYOUT_TONE = { pending: "pending", processing: "claim", succeeded: "money", failed: "danger" } as const;

export default async function HuntHome() {
  const me = await fetchMe();
  const account = me.payoutAccount;
  return (
    <>
      <h1 className="sr-only">Hunter</h1>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard emphasis money label="Gagné" value={formatXof(me.earnings.totalXof)} sub={`${me.earnings.paidCount} bounty(s) payée(s)`} />
        <StatCard label="Réservations en cours" value={String(me.activeClaims.length)} sub="issues sur lesquelles tu travailles" />
        <StatCard
          label="Compte de paiement"
          value={account?.status === "verified" ? "Prêt" : "À relier"}
          sub="sats sur ta Lightning Address"
        />
      </div>

      {account?.status !== "verified" ? (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <span>Relie ta Lightning Address une fois pour être payé en sats dès la fusion.</span>
          <Link href="/me" className={buttonClass({ size: "sm" })}>
            Relier mon compte
          </Link>
        </Card>
      ) : null}

      <Section id="claims" title="Mes réservations">
        {me.activeClaims.length ? (
          <Card padding="none">
            <ul className="divide-y divide-rule text-sm">
              {me.activeClaims.map((c) => (
                <li key={c.bountyId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <Link href={`/b/${c.bountyId}`} className="grid min-w-0 gap-0.5 hover:underline">
                    <b className="truncate font-semibold">{c.issueTitle}</b>
                    <span className="font-mono text-[0.78rem] text-muted">{c.repoFullName}</span>
                  </Link>
                  <span className="font-mono text-xs text-muted">
                    expire {new Date(c.expiresAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" })} UTC
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <EmptyState
            title="Aucune réservation"
            action={
              <Link href="/explore" className={buttonClass({ size: "sm" })}>
                Voir les issues payées
              </Link>
            }
          >
            Choisis une issue payée et commente <code className="font-mono">/claim</code> sur GitHub.
          </EmptyState>
        )}
      </Section>

      <Section id="earnings" title="Gains">
        {me.payouts.length ? (
          <Card padding="none">
            <ul className="divide-y divide-rule text-sm">
              {me.payouts.map((p) => (
                <li key={`${p.bountyId}-${p.paidAt ?? p.status}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <Link href={p.receiptId ? `/r/${p.receiptId}` : `/b/${p.bountyId}`} className="font-bold hover:underline">
                    {formatXof(p.amountXof)}
                  </Link>
                  <Pill tone={PAYOUT_TONE[p.status]} size="sm">
                    {PAYOUT_LABEL[p.status]}
                  </Pill>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <EmptyState title="Pas encore de gains">Ton premier paiement arrive en sats dès que ta PR est fusionnée.</EmptyState>
        )}
      </Section>
    </>
  );
}

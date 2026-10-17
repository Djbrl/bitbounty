import Link from "next/link";
import { formatXof } from "../ui/amount";
import { buttonClass } from "../ui/button";
import { Card } from "../ui/card";
import { Pill } from "../ui/pill";
import type { Receipt } from "./data";
import { receiptRows, xofToEur } from "./shape";
import { ShareButton } from "./share-button";

/** Shareable receipt (/r/[id]), Kraken "sent" layout from the build kit: avatar, big amount, key/value list, status, reference. */
export function ReceiptView({ r }: { r: Receipt }) {
  const repo = r.repoFullName.split("/")[1] ?? r.repoFullName;
  return (
    <Card padding="lg" emphasis className="mx-auto grid w-full max-w-md gap-5" data-receipt={r.id}>
      <div className="grid justify-items-center gap-1.5 pt-2 text-center">
        <span aria-hidden className="grid size-[52px] place-items-center rounded-full bg-money text-xl font-bold text-on-solid">
          ✓
        </span>
        <span className="text-[13px] text-muted">
          {repo} #{r.issueNumber}
        </span>
        <b className="font-display text-[2.4rem] font-extrabold leading-none tabular-nums text-money">
          +{formatXof(r.amountXof).slice(0, -2)} FCFA
        </b>
        <span className="text-xs text-muted">{xofToEur(r.amountXof)}</span>
        <Pill tone="money-solid" dot className="mt-1">
          Payé
        </Pill>
      </div>

      <dl className="grid">
        {receiptRows(r).map((row) => (
          <div key={row.key} className="flex items-baseline justify-between gap-3 border-t border-rule py-2.5 text-sm">
            <dt className="shrink-0 text-muted">{row.label}</dt>
            <dd className={row.key === "speed" ? "text-right font-bold text-money" : "min-w-0 text-right break-words"}>
              {row.value}
            </dd>
          </div>
        ))}
        <div className="grid gap-1 border-t border-rule py-2.5 text-sm">
          <dt className="text-muted">Réf. Bitnob</dt>
          <dd className="font-mono text-[12px] break-all">{r.bitnobReference}</dd>
        </div>
        <div className="grid gap-1 border-t border-rule py-2.5 text-sm">
          <dt className="text-muted">Signature</dt>
          <dd className="font-mono text-[11px] break-all text-muted">{r.signature}</dd>
        </div>
      </dl>

      <div className="grid gap-2">
        <ShareButton title={`Reçu BitBounty · ${repo} #${r.issueNumber}`} />
        <div className="grid grid-cols-2 gap-2">
          <a href={r.prUrl} target="_blank" rel="noreferrer" className={buttonClass({ variant: "ghost", size: "sm" })}>
            PR #{r.prNumber} ↗
          </a>
          <Link href={`/b/${r.bountyId}`} className={buttonClass({ variant: "ghost", size: "sm" })}>
            Voir la bounty
          </Link>
        </div>
      </div>
    </Card>
  );
}

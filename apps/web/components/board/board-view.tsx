import { Page } from "../ui";
import { BountyList } from "./bounty-list";
import { ExternalList } from "./external-list";
import { HeroStats } from "./hero-stats";
import { LivePayouts } from "./live-payouts";
import { openBounties, type Board, type PayoutRow } from "./shape";

export const BOARD_NAV = [
  { href: "/", label: "Board" },
  { href: "/live", label: "Live" },
  { href: "/dashboard", label: "For maintainers" },
];

export interface BoardViewProps {
  board: Board;
  payouts: PayoutRow[];
  issues: Record<string, number>;
}

/** Public board (build kit screen 7): hero stats, funded issues with filters, live payouts column. */
export function BoardView({ board, payouts, issues }: BoardViewProps) {
  return (
    <Page nav={{ items: BOARD_NAV, active: "/" }}>
      <section className="grid gap-5">
        <div className="grid gap-2">
          <h1 className="max-w-[22ch] font-display text-[clamp(1.9rem,5vw,3rem)] font-extrabold leading-[1.05] tracking-tight">
            Fix an issue. Get paid on your phone.
          </h1>
          <p className="max-w-[60ch] text-muted">
            Every issue below is already funded. Merge your pull request and the bounty lands on Wave, Orange Money or
            Free Money, in FCFA, minutes later.
          </p>
        </div>
        <HeroStats stats={board.stats} />
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid min-w-0 gap-8">
          <BountyList bounties={openBounties(board.bounties)} />
          <ExternalList rows={board.external} />
        </div>
        <div className="lg:sticky lg:top-6">
          <LivePayouts initial={payouts} issues={issues} />
        </div>
      </div>
    </Page>
  );
}

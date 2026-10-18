import { ExploreGrid } from "../hunt/explore-grid";
import { huntText, type Lang } from "../hunt/text";
import { Page } from "../ui";
import { ExternalList } from "./external-list";
import { HeroStats } from "./hero-stats";
import { LivePayouts } from "./live-payouts";
import { openBounties, type Board, type PayoutRow } from "./shape";

export const BOARD_NAV = [
  { href: "/explore", label: "Board" },
  { href: "/live", label: "Live" },
  { href: "/dashboard", label: "For maintainers" },
];

export interface BoardViewProps {
  board: Board;
  payouts: PayoutRow[];
  issues: Record<string, number>;
  /** U3: copy language (bb_lang cookie, French by default). */
  lang?: Lang;
  /** U3: search text from the app header (`/explore?q=`). */
  q?: string;
  /** Render time (ms), for "posted 3 h ago". */
  now?: number;
}

/** Public board (build kit screen 7): hero stats, funded issues as a filterable card grid (U3), live payouts column. */
export function BoardView({ board, payouts, issues, lang = "fr", q = "", now = Date.now() }: BoardViewProps) {
  const t = huntText(lang);
  return (
    <Page nav={{ items: BOARD_NAV, active: "/explore" }}>
      <section className="grid gap-5">
        <div className="grid gap-2">
          <h1 className="max-w-[22ch] text-[clamp(1.9rem,5vw,3rem)] font-extrabold leading-[1.05] tracking-tight">{t.exploreTitle}</h1>
          <p className="max-w-[60ch] text-muted">{t.exploreLead}</p>
        </div>
        <HeroStats stats={board.stats} />
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid min-w-0 gap-8">
          <ExploreGrid bounties={openBounties(board.bounties)} lang={lang} now={now} q={q} />
          <ExternalList rows={board.external} />
        </div>
        <div className="lg:sticky lg:top-6">
          <LivePayouts initial={payouts} issues={issues} />
        </div>
      </div>
    </Page>
  );
}

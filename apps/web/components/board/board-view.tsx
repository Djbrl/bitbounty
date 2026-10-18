import Link from "next/link";
import type { ReactNode } from "react";
import { projectSummaries } from "../hunt/explore";
import { ExploreGrid } from "../hunt/explore-grid";
import { ProjectGrid } from "../hunt/project-grid";
import { huntText, type Lang } from "../hunt/text";
import { Amount, Page } from "../ui";
import { openBounties, type Board, type PayoutRow } from "./shape";

export const BOARD_NAV = [
  { href: "/explore", label: "Board" },
  { href: "/live", label: "Live" },
  { href: "/dashboard", label: "For maintainers" },
];

export interface BoardViewProps {
  board: Board;
  /** Kept for callers; explore no longer shows the live column (calm "mission select"). */
  payouts?: PayoutRow[];
  issues?: Record<string, number>;
  /** U3: copy language (bb_lang cookie, French by default). */
  lang?: Lang;
  /** U3: search text from the app header (`/explore?q=`): lists matching issues across projects. */
  q?: string;
  /** Drill into one project (`?repo=owner/name`): its open bounties. */
  repo?: string;
  /** Render time (ms), for "posted 3 h ago". */
  now?: number;
  /** Route this view lives on: "/explore" (public) or "/app/explore" (inside the app shell). */
  base?: string;
  /** Inside the app shell: no public top nav. */
  inShell?: boolean;
}

/**
 * Explore as a "mission select": every BitBounty-enabled project with open bounties, each leading
 * to that project's issues. `?repo=` shows one project's bounties, `?q=` searches issues.
 */
export function BoardView({ board, lang = "fr", q = "", repo = "", now = Date.now(), base = "/explore", inShell = false }: BoardViewProps) {
  const t = huntText(lang);
  const open = openBounties(board.bounties);
  const projects = projectSummaries(open);
  const project = repo ? projects.find((p) => p.repoFullName === repo) : undefined;
  const query = q.trim();

  let body: ReactNode;
  if (repo) {
    const rows = open.filter((b) => b.repoFullName === repo);
    body = (
      <>
        <BackLink base={base} label={t.allProjects} />
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid gap-1">
            <p className="font-mono text-[12px] text-muted">{repo.split("/")[0]}</p>
            <h1 className="text-[clamp(1.6rem,4vw,2.2rem)] font-extrabold leading-tight tracking-tight">{repo.split("/")[1] ?? repo}</h1>
            <a href={`https://github.com/${repo}`} className="text-[13px] text-muted hover:text-ink hover:underline">
              github.com/{repo}
            </a>
          </div>
          {project ? (
            <div className="grid justify-items-end gap-0.5 text-[12px] text-muted">
              <Amount xof={project.totalXof} size="md" money={project.claimableCount > 0} />
              <span>{t.toClaim(project.claimableCount)}</span>
            </div>
          ) : null}
        </header>
        <ExploreGrid key={repo} bounties={rows} lang={lang} now={now} fixedRepo={repo} title={t.openBountiesOn} />
      </>
    );
  } else if (query) {
    body = (
      <>
        <BackLink base={base} label={t.allProjects} />
        <ExploreGrid key={query} bounties={open} lang={lang} now={now} q={query} title={t.searchResults} />
      </>
    );
  } else {
    body = (
      <>
        <header className="grid gap-2">
          <h1 className="text-[clamp(1.7rem,4vw,2.4rem)] font-extrabold leading-tight tracking-tight">{t.exploreTitle}</h1>
          <p className="max-w-[62ch] text-muted">{t.exploreLead}</p>
        </header>
        <ProjectGrid projects={projects} lang={lang} base={base} />
      </>
    );
  }

  const content = <div className="grid min-w-0 content-start gap-6">{body}</div>;
  return inShell ? content : <Page nav={{ items: BOARD_NAV, active: "/explore" }}>{content}</Page>;
}

function BackLink({ base, label }: { base: string; label: string }) {
  return (
    <Link href={base} className="justify-self-start text-[13px] font-semibold text-muted hover:text-ink">
      ← {label}
    </Link>
  );
}

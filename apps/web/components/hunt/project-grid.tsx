// Explore "mission select": one calm card per BitBounty-enabled repo, leading to its open bounties.
import Link from "next/link";
import { Amount, Card, EmptyState, Tag } from "../ui";
import type { ProjectSummary } from "./explore";
import { huntText, type Lang } from "./text";

export function projectHref(base: string, repoFullName: string): string {
  return `${base}?repo=${encodeURIComponent(repoFullName)}`;
}

export function ProjectGrid({ projects, lang, base }: { projects: ProjectSummary[]; lang: Lang; base: string }) {
  const t = huntText(lang);
  if (projects.length === 0) {
    return (
      <EmptyState title={t.noProjects} align="start">
        {t.noOpenBody}
      </EmptyState>
    );
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-tour="projects">
      {projects.map((p) => (
        <Card as="li" key={p.repoFullName} padding="none" className="transition-colors hover:border-ink/30">
          <Link href={projectHref(base, p.repoFullName)} className="flex h-full flex-col gap-3 p-4 focus-visible:outline-2 focus-visible:outline-money">
            <div className="flex items-center gap-3">
              <img
                src={`https://github.com/${encodeURIComponent(p.owner)}.png?size=64`}
                alt=""
                width={36}
                height={36}
                className="size-9 shrink-0 rounded-lg border border-rule bg-sheet"
              />
              <div className="min-w-0">
                <p className="truncate font-mono text-[12px] text-muted">{p.owner}</p>
                <h3 className="truncate text-[16px] font-bold leading-tight">{p.name}</h3>
              </div>
            </div>
            <p className="line-clamp-2 text-[13px] text-ink-soft">
              <span className="text-muted">{t.latestIssue} </span>
              {p.latestTitle}
            </p>
            {p.languages.length ? (
              <div className="flex flex-wrap gap-1.5">
                {p.languages.map((l) => (
                  <Tag key={l}>{l}</Tag>
                ))}
              </div>
            ) : null}
            <div className="mt-auto flex items-end justify-between gap-2 border-t border-rule pt-3">
              <div className="grid gap-0.5 text-[12px]">
                <span className="font-semibold">{t.openIssues(p.openCount)}</span>
                <span className={p.claimableCount ? "text-money" : "text-muted"}>{t.toClaim(p.claimableCount)}</span>
              </div>
              <Amount xof={p.totalXof} size="md" money={p.claimableCount > 0} className="text-right" />
            </div>
          </Link>
        </Card>
      ))}
    </ul>
  );
}

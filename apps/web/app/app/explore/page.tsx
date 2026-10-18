// Explore inside the app shell (sidebar kept): the project "mission select", one project's bounties, or issue search.
import type { Metadata } from "next";
import { LANG_COOKIE, parseLang } from "@/components/app-shell/mode";
import { BoardView } from "@/components/board/board-view";
import { getBoard } from "@/components/board/data";
import { exploreQuery, type ExploreParams } from "@/components/hunt/explore";
import { readCookie } from "@/components/hunt/data";

export const metadata: Metadata = { title: "Explore · BitBounty" };
export const dynamic = "force-dynamic";

export default async function AppExplore({ searchParams }: { searchParams: Promise<ExploreParams> }) {
  const [board, langCookie, params] = await Promise.all([getBoard(), readCookie(LANG_COOKIE), searchParams]);
  const { q, repo } = exploreQuery(params);
  return <BoardView board={board} lang={parseLang(langCookie)} q={q} repo={repo} now={Date.now()} base="/app/explore" inShell />;
}

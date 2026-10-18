import type { Metadata } from "next";
import { LANG_COOKIE, parseLang } from "@/components/app-shell/mode";
import { readCookie } from "@/components/hunt/data";
import { BoardView } from "../../components/board/board-view";
import { orFallback } from "../../lib/api";
import { getBoard, getIssueIndex, getRecentPayouts } from "../../components/board/data";

export const metadata: Metadata = {
  title: "BitBounty · Paid issues",
  description: "Funded GitHub issues in FCFA, paid in sats over Lightning minutes after merge.",
};

// Rendered per request: the data comes from the server (I1), never baked in at build time.
export const dynamic = "force-dynamic";

type Params = { q?: string | string[] };

export default async function Home({ searchParams }: { searchParams: Promise<Params> }) {
  const [board, payouts, issues, langCookie, params] = await Promise.all([
    getBoard(),
    orFallback(getRecentPayouts(), [], "recent payouts"),
    orFallback(getIssueIndex(), {}, "issue index"),
    readCookie(LANG_COOKIE),
    searchParams,
  ]);
  const q = (Array.isArray(params.q) ? params.q[0] : params.q) ?? "";
  return <BoardView board={board} payouts={payouts} issues={issues} lang={parseLang(langCookie)} q={q.slice(0, 100)} now={Date.now()} />;
}

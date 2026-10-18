import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LANG_COOKIE, parseLang } from "@/components/app-shell/mode";
import { readCookie } from "@/components/hunt/data";
import { BoardView } from "../../components/board/board-view";
import { getBoard } from "../../components/board/data";
import { exploreQuery, type ExploreParams } from "../../components/hunt/explore";
import { sessionLogin } from "../../lib/session-login";

export const metadata: Metadata = {
  title: "BitBounty · Explore",
  description: "Open-source projects with funded GitHub issues in FCFA, paid in sats over Lightning minutes after merge.",
};

// Rendered per request: the data comes from the server (I1), never baked in at build time.
export const dynamic = "force-dynamic";

/** Public explore (the landing links here). Signed-in users get the same view inside the app shell. */
export default async function Explore({ searchParams }: { searchParams: Promise<ExploreParams> }) {
  const [params, login] = await Promise.all([searchParams, sessionLogin()]);
  const { q, repo } = exploreQuery(params);
  if (login) {
    const qs = new URLSearchParams(Object.entries({ q, repo }).filter(([, v]) => v)).toString();
    redirect(`/app/explore${qs ? `?${qs}` : ""}`);
  }
  const [board, langCookie] = await Promise.all([getBoard(), readCookie(LANG_COOKIE)]);
  return <BoardView board={board} lang={parseLang(langCookie)} q={q} repo={repo} now={Date.now()} />;
}

import type { Metadata } from "next";
import { LiveBoard } from "../../components/live/live-board";
import { parseSpeed } from "../../components/live/live-data";
import { fetchLiveSnapshot } from "../../components/live/live-snapshot";

// Rendered per request: the data comes from the server (I1), never baked in at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "BitBounty · live",
  description: "Projector screen: bounties move from funded to paid as webhooks arrive.",
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** /live: full-screen projector board. `?speed=4` fast-forwards the mock stream. */
export default async function LivePage({ searchParams }: Props) {
  const { speed } = await searchParams;
  return <LiveBoard initial={await fetchLiveSnapshot()} speed={parseSpeed(speed)} />;
}

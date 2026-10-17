import type { Metadata } from "next";
import { LiveBoard } from "../../components/live/live-board";
import { parseSpeed } from "../../components/live/live-data";
import { getLiveSnapshot } from "../../components/live/live-snapshot";

export const metadata: Metadata = {
  title: "BitBounty · live",
  description: "Projector screen: bounties move from funded to paid as webhooks arrive.",
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** /live: full-screen projector board. `?speed=4` fast-forwards the mock stream. */
export default async function LivePage({ searchParams }: Props) {
  const { speed } = await searchParams;
  return <LiveBoard initial={getLiveSnapshot()} speed={parseSpeed(speed)} />;
}

import type { Metadata } from "next";
import { BoardView } from "../components/board/board-view";
import { getBoard, getIssueIndex, getRecentPayouts } from "../components/board/data";

export const metadata: Metadata = {
  title: "BitBounty · Paid issues",
  description: "Funded GitHub issues, paid to mobile money in FCFA minutes after merge.",
};

export default async function Home() {
  const [board, payouts, issues] = await Promise.all([getBoard(), getRecentPayouts(), getIssueIndex()]);
  return <BoardView board={board} payouts={payouts} issues={issues} />;
}

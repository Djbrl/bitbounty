import { formatXof, StatCard } from "../ui";
import type { Board } from "./shape";

/** The four numbers that prove the money is real. */
export function HeroStats({ stats }: { stats: Board["stats"] }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard label="Bounties paid" value={stats.paidCount} sub="merged and paid out" />
      <StatCard label="Paid to developers" value={formatXof(stats.paidTotalXof)} money sub="FCFA, on mobile money" />
      <StatCard label="Median merge → paid" value={`${stats.medianMinutesMergeToPay} min`} sub="from merge to phone" />
      <StatCard label="Developers paid" value={stats.developersPaid} sub="on Wave, Orange Money, Free" />
    </div>
  );
}

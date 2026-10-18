import { formatXof, StatCard } from "../ui";
import type { Board } from "./shape";

/** Totals across all bounties: paid count, amount paid, median merge → paid, developers paid. */
export function HeroStats({ stats }: { stats: Board["stats"] }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard label="Bounties paid" value={stats.paidCount} />
      <StatCard label="Paid to developers" value={formatXof(stats.paidTotalXof)} money />
      <StatCard label="Median merge → paid" value={`${stats.medianMinutesMergeToPay} min`} />
      <StatCard label="Developers paid" value={stats.developersPaid} />
    </div>
  );
}

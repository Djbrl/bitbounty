"use client";
// U3 (G5): time left on a claim, ticking every 30 s, with a bar of the claim window used.
import { useEffect, useState } from "react";
import { cx } from "../ui";
import { claimElapsed, formatCountdown } from "./shape";
import { huntText, type Lang } from "./text";

const URGENT_MS = 6 * 3600_000;

export function ClaimCountdown({ expiresAt, createdAt, lang, now: initial }: { expiresAt: string; createdAt: string | null; lang: Lang; now: number }) {
  const t = huntText(lang);
  const [now, setNow] = useState(initial);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const left = Date.parse(expiresAt) - now;
  const used = claimElapsed(createdAt, expiresAt, now);
  const urgent = left < URGENT_MS;
  return (
    <div className="grid gap-1.5">
      <p className={cx("font-mono text-sm tabular-nums", left <= 0 ? "text-danger" : urgent ? "text-pending" : "text-ink")} suppressHydrationWarning>
        {left <= 0 ? t.expired : `${formatCountdown(left, lang)} ${t.left}`}
      </p>
      {used !== null ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-chip" role="presentation">
          <div className={cx("h-full rounded-full", urgent ? "bg-pending" : "bg-claim")} style={{ width: `${Math.round(used * 100)}%` }} suppressHydrationWarning />
        </div>
      ) : null}
    </div>
  );
}

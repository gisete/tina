import Link from "next/link";
import { formatDurationMs } from "@/lib/format";
import type { LastNightScore } from "@/lib/today/last-night-score";

export default function SleepCard({ night }: { night: LastNightScore }) {
  return (
    <Link
      href="/dashboard/sleep"
      className="block bg-white border border-outline-variant rounded-[1.5rem] p-card-padding hover:bg-surface-container transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-display text-xl font-bold text-on-surface tracking-tight">Last night</h2>
        <span className="text-xs font-semibold text-on-surface-variant">Sleep details ›</span>
      </div>
      {night.kind === "not-synced" ? (
        <p className="mt-2 text-sm text-on-surface-variant">Not synced yet</p>
      ) : (
        <div className="mt-2 flex items-baseline gap-3">
          <span className="font-display text-4xl font-bold text-on-surface tracking-tight">{night.score}</span>
          <span className="text-sm text-on-surface-variant">Sleep score · {formatDurationMs(night.totalSleepMs)}</span>
          {night.partial && (
            <span title="Heart-rate data for this night isn't cached yet, so the score leaves it out" className="text-xs text-on-surface-variant">
              partial
            </span>
          )}
        </div>
      )}
    </Link>
  );
}

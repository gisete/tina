import { formatDurationMs, formatClockTime, formatEfficiencyPct, formatDateLong } from "@/lib/format";

interface Props {
  totalSleepMs: number;
  holisticScore: number;
  efficiencyScore: number;  // 0–1 fraction from DB
  sleepDate: string;        // "YYYY-MM-DD" — string-sliced, no Date construction
  startTime: string;        // ISO-8601
  endTime: string;          // ISO-8601
}

export default function NightSummaryHero({
  totalSleepMs,
  holisticScore,
  efficiencyScore,
  sleepDate,
  startTime,
  endTime,
}: Props) {
  return (
    <div className="py-4">
      {/* Stat row */}
      <div className="flex flex-wrap items-end gap-10 mb-3">

        <div>
          <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1">
            Total sleep
          </p>
          <p className="font-display text-5xl font-bold text-on-surface tracking-tight leading-none">
            {formatDurationMs(totalSleepMs)}
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1 flex items-center gap-2">
            Sleep Score
            <span className="px-1.5 py-0.5 bg-primary-container text-black font-semibold text-[10px] rounded-full normal-case tracking-normal">
              Target &gt;85
            </span>
          </p>
          <p className="font-display text-5xl font-bold text-on-surface tracking-tight leading-none">
            {holisticScore}
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1">
            Efficiency
          </p>
          <p className="font-display text-5xl font-bold text-on-surface tracking-tight leading-none">
            {formatEfficiencyPct(efficiencyScore)}
          </p>
        </div>

      </div>

      {/* Sub-line: date · bed–wake window */}
      <p className="text-sm text-on-surface-variant">
        {formatDateLong(sleepDate)}
        <span className="mx-2 text-outline-variant">·</span>
        {formatClockTime(startTime)}
        <span className="mx-1.5 text-outline-variant">–</span>
        {formatClockTime(endTime)}
      </p>
    </div>
  );
}

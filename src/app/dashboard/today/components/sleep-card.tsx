import Link from "next/link";
import { formatDurationMins, formatEfficiencyPct } from "@/lib/format";
import { SLEEP_SCORE_TARGET } from "@/lib/analytics/sleep";
import { buildStageMix, type MixStage } from "@/lib/charts/stage-mix";
import type { LastNightScore } from "@/lib/today/last-night-score";
import { EmptyStateCard, StatCard, StatPill, StatValue } from "../../components/stat-card";

const STAGE_STYLE: Record<MixStage, { label: string; bar: string }> = {
  deep: { label: "Deep", bar: "bg-stage-deep" },
  light: { label: "Light", bar: "bg-stage-light" },
  rem: { label: "REM", bar: "bg-stage-rem" },
  awake: { label: "Awake", bar: "bg-stage-awake" },
};

const DETAILS_LINK = (
  <Link href="/dashboard/sleep" className="text-sm font-medium text-sleep-ink hover:underline">
    Sleep details →
  </Link>
);

export default function SleepCard({ night, className = "" }: { night: LastNightScore; className?: string }) {
  if (night.kind === "not-synced") {
    return (
      <EmptyStateCard
        eyebrow="Last night"
        className={className}
        topRight={<Link href="/dashboard/sleep" className="text-xs font-semibold text-on-surface-variant hover:text-on-surface transition-colors">Sleep details →</Link>}
      >
        <p className="text-xl text-on-surface">Not synced yet</p>
      </EmptyStateCard>
    );
  }

  const { detail } = night;
  const mix = buildStageMix(detail.stageMins);
  const asleepMins = Math.round(night.totalSleepMs / 60000);

  return (
    <StatCard tone="sleep" size="hero" eyebrow="Last night" topRight={DETAILS_LINK} className={className}>
      <StatValue
        tone="sleep"
        size="hero"
        value={String(night.score)}
        unit="sleep score"
        inline={<StatPill tone="sleep">Target &gt;{SLEEP_SCORE_TARGET}</StatPill>}
        caption={
          <>
            {formatDurationMins(asleepMins)} asleep
            {detail.efficiency !== null && <> · {formatEfficiencyPct(detail.efficiency)} efficiency</>}
            {night.partial && (
              <span title="Heart-rate data for this night isn't cached yet, so the score leaves it out" className="ml-2 opacity-70">
                · partial
              </span>
            )}
          </>
        }
      />
      {mix.length > 0 && (
        <div>
          <div aria-hidden className="flex h-3.5 gap-[3px]">
            {mix.map((seg) => (
              <div key={seg.stage} className={`min-w-0 basis-0 rounded-full ${STAGE_STYLE[seg.stage].bar}`} style={{ flexGrow: seg.grow }} />
            ))}
          </div>
          <ul className="mt-3.5 flex flex-wrap gap-x-7 gap-y-2 text-sm">
            {mix.map((seg) => (
              <li key={seg.stage} className="flex items-center gap-2">
                <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${STAGE_STYLE[seg.stage].bar}`} />
                {STAGE_STYLE[seg.stage].label} <span className="text-sleep-muted">{formatDurationMins(seg.minutes)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </StatCard>
  );
}

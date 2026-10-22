import type { LastNightScore } from "@/lib/today/last-night-score";
import { EmptyStateCard, StatCard, StatPill, StatValue } from "../../components/stat-card";

export default function NightHeartCard({ night, className = "" }: { night: LastNightScore; className?: string }) {
  const heart = night.kind === "scored" ? night.detail.heart : null;
  if (!heart || heart.restingHr === null) {
    return (
      <EmptyStateCard eyebrow="Night heart rate" className={className}>
        <p className="text-xl text-on-surface">Awaiting overnight readings</p>
      </EmptyStateCard>
    );
  }

  const parts: string[] = [];
  if (heart.hrv !== null) parts.push(`${heart.hrv} ms HRV`);
  if (heart.baselineRhr !== null) parts.push(`baseline ${heart.baselineRhr} bpm`);

  return (
    <StatCard
      tone="heart"
      eyebrow="Night heart rate"
      className={className}
      topRight={heart.status === "insufficient" ? undefined : <StatPill tone="heart"><span className="capitalize">{heart.status}</span></StatPill>}
    >
      <StatValue tone="heart" size="tile" value={String(heart.restingHr)} unit="bpm" caption={parts.length > 0 ? parts.join(" · ") : undefined} />
    </StatCard>
  );
}

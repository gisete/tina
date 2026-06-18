"use client";

import type { SleepScoreBreakdown, SleepScoreComponentKey } from "@/lib/analytics/sleep";
import ExpandableCard from "./expandable-card";

const LABELS: Record<SleepScoreComponentKey, { label: string; description: string }> = {
  volume:      { label: "Total sleep",     description: "How much you slept" },
  efficiency:  { label: "Efficiency",      description: "Asleep vs. time in bed" },
  continuity:  { label: "Deep continuity", description: "Unbroken deep sleep" },
  disruption:  { label: "Disruption",      description: "Wake-ups and restlessness" },
  cardiac:     { label: "RHR recovery",    description: "Night heart rate vs. baseline" },
};

interface Props {
  score: number;
  breakdown: SleepScoreBreakdown | null | undefined;
}

// Shared pill — same markup in both the no-breakdown and breakdown paths.
const TARGET_PILL = (
  <span className="px-2 py-0.5 bg-primary-container text-black font-semibold text-xs rounded-full">
    Target &gt;85
  </span>
);

export default function SleepScoreCard({ score, breakdown }: Props) {
  // No breakdown: static card with no expand toggle (preserves current behaviour
  // when last-night data is unavailable).
  if (!breakdown) {
    return (
      <div className="bg-white border border-outline-variant rounded-[1.5rem] p-card-padding hover:shadow-[0px_20px_40px_rgba(0,0,0,0.05)] transition-shadow">
        <div className="flex items-start justify-between mb-4">
          <h2 className="font-display text-xl font-bold text-on-surface tracking-tight">
            Sleep Score
          </h2>
          {TARGET_PILL}
        </div>
        <div className="font-display text-4xl font-bold text-black tracking-tight">{score}</div>
        <div className="text-sm text-on-surface-variant mt-1">
          Weighted composite of volume, efficiency, continuity, disruption, and cardiac recovery
        </div>
      </div>
    );
  }

  const overview = (
    <>
      <div className="font-display text-4xl font-bold text-black tracking-tight">{score}</div>
      <div className="text-sm text-on-surface-variant mt-1">
        Weighted composite of volume, efficiency, continuity, disruption, and cardiac recovery
      </div>
    </>
  );

  return (
    <ExpandableCard
      title="Sleep Score"
      headerRight={TARGET_PILL}
      overview={overview}
      defaultExpanded={false}
      expandLabel="How this is calculated"
      className="hover:shadow-[0px_20px_40px_rgba(0,0,0,0.05)] transition-shadow"
    >
      <div className="space-y-3">
        {breakdown.components.map((c) => {
          const meta = LABELS[c.key];
          if (!c.present) {
            return (
              <p key={c.key} className="text-xs text-on-surface-variant italic">
                {meta.label}: weight redistributed — no data this night
              </p>
            );
          }
          return (
            <div key={c.key} className="space-y-1">
              <div className="flex items-baseline justify-between gap-4">
                <div className="min-w-0">
                  <span className="text-sm font-semibold text-on-surface">{meta.label}</span>
                  <span className="text-xs text-on-surface-variant ml-2">{meta.description}</span>
                </div>
                <div className="shrink-0 text-right text-xs text-on-surface-variant whitespace-nowrap">
                  <span className="font-semibold text-on-surface">{(c.subScore ?? 0).toFixed(0)}</span>
                  <span>/100</span>
                  <span className="mx-1.5">·</span>
                  <span>{Math.round(c.weight * 100)}%</span>
                  <span className="mx-1.5">·</span>
                  <span className="font-semibold text-on-surface">{c.contribution.toFixed(1)}</span>
                  <span> pts</span>
                </div>
              </div>
              <div className="h-1.5 w-full bg-surface-container-high rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${c.subScore ?? 0}%`,
                    backgroundColor: "var(--color-heart-accent)",
                  }}
                />
              </div>
            </div>
          );
        })}

        <div className="pt-2 border-t border-outline-variant flex justify-between items-center">
          <span className="text-sm font-semibold text-on-surface">Total</span>
          <span className="font-display text-lg font-bold text-black">{score}</span>
        </div>
      </div>
    </ExpandableCard>
  );
}

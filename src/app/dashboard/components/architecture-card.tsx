import type { ReactNode } from "react";
import { buildTargetBar } from "@/lib/charts/target-bar";
import { EYEBROW, NeutralCard } from "./stat-card";

export interface ArchitectureRow {
  key: "deep" | "rem" | "light";
  name: string;
  blurb: string;
  pct: number;
  targetLo: number;
  targetHi: number;
  /** Engine status word (e.g. "consolidated"); shown in a neutral chip. */
  status: string | null;
  explainer: ReactNode;
}

// Full literal class strings (Tailwind v4).
const FILL: Record<ArchitectureRow["key"], string> = {
  deep: "bg-stage-deep",
  rem: "bg-stage-rem",
  light: "bg-stage-light",
};

export default function ArchitectureCard({ rows, className = "" }: { rows: ArchitectureRow[]; className?: string }) {
  return (
    <NeutralCard className={className}>
      <h2 className={`${EYEBROW} text-on-surface-variant`}>Architecture breakdown</h2>
      <div className="mt-5 space-y-9">
        {rows.map((row) => {
          const bar = buildTargetBar(row.pct, row.targetLo, row.targetHi);
          return (
            <div key={row.key}>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2.5">
                    <span className="text-xl text-on-surface">{row.name}</span>
                    {row.status && (
                      <span className="rounded-full bg-sleep-surface-soft px-2.5 py-[3px] text-[11px] font-medium uppercase tracking-[0.06em] text-sleep-ink">
                        {row.status}
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-sm text-on-surface-variant">{row.blurb}</p>
                </div>
                <p className="flex items-baseline gap-2">
                  <span className="font-display text-[56px] font-light leading-[0.9] tracking-[-0.03em]">{row.pct}%</span>
                  <span className="text-base text-on-surface-variant">
                    / {row.targetLo}–{row.targetHi}%
                  </span>
                </p>
              </div>
              <div aria-hidden className="relative mt-5 h-3.5 overflow-hidden rounded-[7px] bg-hairline">
                <div className="absolute inset-y-0 bg-sleep-surface-strong" style={{ left: `${bar.bandLeftPct}%`, width: `${bar.bandWidthPct}%` }} />
                <div className={`absolute inset-y-0 left-0 rounded-[7px] ${FILL[row.key]}`} style={{ width: `${bar.fillPct}%` }} />
              </div>
              <div className="mt-2 flex justify-between text-[13px] text-on-surface-variant">
                <span>0%</span>
                <span>
                  target {row.targetLo}–{row.targetHi}%
                </span>
                <span>{bar.axisMax}%</span>
              </div>
              {row.explainer}
            </div>
          );
        })}
      </div>
    </NeutralCard>
  );
}

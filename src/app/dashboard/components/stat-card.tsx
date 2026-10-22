import type { ReactNode } from "react";

/** Domain, never value: a card's tint says what it measures, not how it's going. */
export type Tone = "sleep" | "heart" | "activity" | "nutrition";
/** hero: Today's last-night card · feature: lead number of a page · tall/tile: supporting numbers. */
export type StatSize = "hero" | "feature" | "tall" | "tile";
/** Lightness step within one domain (sleep only); never a status. */
export type Shade = "base" | "strong" | "soft";

// Full literal class strings only: Tailwind v4 can't see dynamically built names.
const TONES: Record<Tone, { surface: string; ink: string; muted: string }> = {
  sleep: { surface: "bg-sleep-surface", ink: "text-sleep-ink", muted: "text-sleep-muted" },
  heart: { surface: "bg-heart-surface", ink: "text-heart-ink", muted: "text-heart-muted" },
  activity: { surface: "bg-activity-surface", ink: "text-activity-ink", muted: "text-activity-muted" },
  nutrition: { surface: "bg-nutrition-surface", ink: "text-nutrition-ink", muted: "text-nutrition-muted" },
};

const SLEEP_SHADES: Record<Exclude<Shade, "base">, string> = {
  strong: "bg-sleep-surface-strong",
  soft: "bg-sleep-surface-soft",
};

const SIZES: Record<StatSize, { card: string; numeral: string; caption: string; unitGap: string; captionGap: string }> = {
  hero: {
    card: "min-h-[400px] p-8",
    numeral: "text-[112px] md:text-[144px] leading-[0.85] tracking-[-0.04em]",
    caption: "text-base",
    unitGap: "gap-x-[18px] gap-y-1.5",
    captionGap: "mt-4",
  },
  feature: {
    card: "min-h-[220px] p-7",
    numeral: "text-[104px] leading-[0.85] tracking-[-0.04em]",
    caption: "text-sm",
    unitGap: "gap-x-2.5",
    captionGap: "mt-3.5",
  },
  tall: {
    card: "min-h-[220px] p-7",
    numeral: "text-[80px] leading-[0.9] tracking-[-0.035em]",
    caption: "text-sm",
    unitGap: "gap-x-2.5",
    captionGap: "mt-3.5",
  },
  tile: {
    card: "min-h-[192px] p-7",
    numeral: "text-[80px] leading-[0.9] tracking-[-0.035em]",
    caption: "text-sm",
    unitGap: "gap-x-2.5",
    captionGap: "mt-3",
  },
};

export const EYEBROW = "text-xs font-medium uppercase tracking-[0.09em]";

interface StatCardProps {
  tone: Tone;
  eyebrow: string;
  /** Top-right slot: a pill or a link. */
  topRight?: ReactNode;
  size?: StatSize;
  /** Surface lightness within the tone; only the sleep domain defines steps. */
  shade?: Shade;
  /** Layout classes from the grid (col/row spans). */
  className?: string;
  children: ReactNode;
}

export function StatCard({ tone, eyebrow, topRight, size = "tile", shade = "base", className = "", children }: StatCardProps) {
  const t = TONES[tone];
  const surface = tone === "sleep" && shade !== "base" ? SLEEP_SHADES[shade] : t.surface;
  return (
    <section className={`${surface} ${t.ink} rounded-card flex flex-col justify-between gap-6 ${SIZES[size].card} ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <h2 className={`${EYEBROW} ${t.muted}`}>{eyebrow}</h2>
        {topRight}
      </div>
      {children}
    </section>
  );
}

/** Dashed, unfilled card for "nothing here yet" and other quiet states. */
export function EmptyStateCard({
  eyebrow,
  topRight,
  className = "",
  children,
}: {
  eyebrow: string;
  topRight?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`rounded-card border-[1.5px] border-dashed border-outline-variant bg-transparent p-7 min-h-[168px] flex flex-col justify-between gap-4 ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className={`${EYEBROW} text-on-surface-variant`}>{eyebrow}</h2>
        {topRight}
      </div>
      {children}
    </section>
  );
}

/** Neutral white card for charts and anything the user acts on. */
export function NeutralCard({ className = "", children }: { className?: string; children: ReactNode }) {
  return <section className={`rounded-card border border-hairline bg-white p-8 ${className}`}>{children}</section>;
}

/** White pill for tinted cards (the lime accent is for neutral surfaces). */
export function StatPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`shrink-0 rounded-full bg-white px-2.5 py-[3px] text-xs font-medium ${TONES[tone].ink}`}>{children}</span>
  );
}

interface StatValueProps {
  tone: Tone;
  size: StatSize;
  value: string;
  unit?: string;
  /** 26px unit ("%", "h") instead of the default 22px. */
  unitLarge?: boolean;
  /** Sits beside the unit (the hero's target pill). */
  inline?: ReactNode;
  caption?: ReactNode;
}

export function StatValue({ tone, size, value, unit, unitLarge = false, inline, caption }: StatValueProps) {
  const t = TONES[tone];
  const z = SIZES[size];
  return (
    <div>
      <p className={`flex flex-wrap items-baseline ${z.unitGap}`}>
        <span className={`font-display font-light ${z.numeral}`}>{value}</span>
        {unit && <span className={`${unitLarge ? "text-[26px]" : "text-[22px]"} ${t.muted}`}>{unit}</span>}
        {inline && <span className="self-center">{inline}</span>}
      </p>
      {caption && <p className={`${z.captionGap} ${z.caption} ${t.muted}`}>{caption}</p>}
    </div>
  );
}

/** "7h 11m" as two numerals with small muted units. */
export function StatDuration({
  tone,
  size,
  hours,
  minutes,
  caption,
}: {
  tone: Tone;
  size: StatSize;
  hours: number;
  minutes: number;
  caption?: ReactNode;
}) {
  const t = TONES[tone];
  const z = SIZES[size];
  const numeral = `font-display font-light ${z.numeral}`;
  const unit = `text-[26px] ${t.muted}`;
  return (
    <div>
      <p className="flex flex-wrap items-baseline gap-x-1">
        {hours > 0 && (
          <>
            <span className={numeral}>{hours}</span>
            <span className={`${unit} mr-2.5`}>h</span>
          </>
        )}
        <span className={numeral}>{minutes}</span>
        <span className={unit}>m</span>
      </p>
      {caption && <p className={`${z.captionGap} ${z.caption} ${t.muted}`}>{caption}</p>}
    </div>
  );
}

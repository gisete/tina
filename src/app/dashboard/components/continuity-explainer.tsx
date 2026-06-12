"use client";

import { useState } from "react";
import type { StageContinuity, LightSleepStability } from "@/lib/analytics/sleep";
import { formatDurationMins } from "@/lib/format";

type ExplainerProps =
  | { stage: "deep" | "rem"; data: StageContinuity }
  | { stage: "light"; data: LightSleepStability };

/** Normalized view-model so the JSX below reads the same for every stage. */
function deriveModel(props: ExplainerProps) {
  if (props.stage === "light") {
    return {
      rawMins: props.data.totalMinutes,
      effectiveMins: null,
      score: props.data.proportionPercentage,
      penaltyCount: props.data.awakeningsCount,
      hasAnchor: false,
      title: "Stability Analysis",
      valueLabel: "Proportion",
    };
  }
  return {
    rawMins: props.data.rawTotalMinutes,
    effectiveMins: props.data.effectiveMinutes,
    score: props.data.continuityScore,
    penaltyCount: props.data.fragmentationCount,
    // Anchor presence is tracked explicitly by the analytics — a night can
    // contain a 30m+ block yet still score below "consolidated" if fragments
    // dilute the average, so status is not a proxy for it.
    hasAnchor: props.data.anchorCount > 0,
    title: "Continuity Analysis",
    valueLabel: "Score",
  };
}

export default function ContinuityExplainer(props: ExplainerProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { stage } = props;
  const { rawMins, effectiveMins, score, penaltyCount, hasAnchor, title, valueLabel } =
    deriveModel(props);

  return (
    <div className="mt-4 pt-4 border-t border-outline-variant/50">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant hover:text-black flex items-center gap-1 transition-colors"
      >
        {isExpanded ? `Hide ${title}` : "Learn how we calculate this"}
        <span className="text-[10px]">{isExpanded ? "▲" : "▼"}</span>
      </button>

      {isExpanded && (
        <div className="mt-4 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">

          {/* Data Table */}
          <div className="grid grid-cols-3 gap-2 p-3 bg-surface-container-lowest border border-outline-variant rounded-xl">
            <div>
              <div className="text-[10px] uppercase font-semibold text-on-surface-variant tracking-wide">Raw Total</div>
              <div className="font-display text-lg font-bold text-black">{formatDurationMins(rawMins)}</div>
            </div>
            {effectiveMins !== null ? (
              <div>
                <div className="text-[10px] uppercase font-semibold text-on-surface-variant tracking-wide">Effective</div>
                <div className="font-display text-lg font-bold text-black">{formatDurationMins(effectiveMins)}</div>
              </div>
            ) : (
              <div>
                <div className="text-[10px] uppercase font-semibold text-on-surface-variant tracking-wide">Awakenings</div>
                <div className="font-display text-lg font-bold text-black">{penaltyCount}</div>
              </div>
            )}
            <div>
              <div className="text-[10px] uppercase font-semibold text-on-surface-variant tracking-wide">{valueLabel}</div>
              <div className="font-display text-lg font-bold text-black">{score}%</div>
            </div>
          </div>

          {/* Dynamic Explainer Text */}
          <div className="text-xs text-on-surface-variant space-y-2 leading-relaxed bg-surface-container-lowest p-3 rounded-xl border border-outline-variant">
            <div>
              You logged <strong className="text-black">{formatDurationMins(rawMins)}</strong> of {stage} sleep.
            </div>

            {/* DEEP SLEEP TEXT */}
            {stage === "deep" && (
              <>
                {!hasAnchor ? (
                  <p>⚠️ None of your cycles reached the <strong className="text-black">30-minute anchor threshold</strong>. Without these sustained blocks, the restorative value of your sleep is limited.</p>
                ) : (
                  <p>✅ You successfully hit the <strong className="text-black">30-minute anchor threshold</strong>, providing massive restorative value to your physical recovery.</p>
                )}
                {penaltyCount > 0 && (
                  <p>Fragmented sleep (<strong className="text-black">{penaltyCount} cycle(s)</strong> under 15m) introduces recovery &quot;penalties,&quot; reducing your overall continuity rating to <strong className="text-black">{score}%</strong>.</p>
                )}
              </>
            )}

            {/* REM SLEEP TEXT */}
            {stage === "rem" && (
              <>
                {!hasAnchor ? (
                  <p>⚠️ You lacked a <strong className="text-black">25-minute late-night anchor</strong>. REM sleep naturally consolidates toward morning, and missing these long blocks impairs cognitive filing.</p>
                ) : (
                  <p>✅ You achieved sustained, <strong className="text-black">25+ minute REM blocks</strong>, ensuring deep emotional processing and mental clarity.</p>
                )}
                {penaltyCount > 0 && (
                  <p>Micro-interruptions during REM (<strong className="text-black">{penaltyCount} break(s)</strong> under 10m) fragment the dream state, lowering your continuity to <strong className="text-black">{score}%</strong>.</p>
                )}
              </>
            )}

            {/* LIGHT SLEEP TEXT */}
            {stage === "light" && (
              <>
                <p>Light sleep is a transitionary bridge. Its quality is measured not by continuity, but by <strong className="text-black">stability</strong> (avoiding wakefulness) and <strong className="text-black">proportion</strong>.</p>
                {score > 60 ? (
                  <p>⚠️ Light sleep made up <strong className="text-black">{score}%</strong> of your night. When this proportion is elevated, it usually means your body is failing to drop into Deep or REM sleep effectively.</p>
                ) : (
                  <p>✅ Your light sleep proportion (<strong className="text-black">{score}%</strong>) is in the optimal range, leaving plenty of biological bandwidth for restorative stages.</p>
                )}
                {penaltyCount > 0 && (
                  <p>Your light sleep bridges broke down into full awakenings <strong className="text-black">{penaltyCount} time(s)</strong>.</p>
                )}
              </>
            )}
          </div>

        </div>
      )}
    </div>
  );
}

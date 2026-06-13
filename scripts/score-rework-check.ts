/**
 * Spot-check for the reworked holistic sleep score.
 *
 * (a) Real 2026-06-11 night: should land ~60-75, not 93.
 * (b) 7.5h consolidated fixture mostly below baseline: should score 85+.
 * (c) No HR samples at all: score still sane via weight redistribution.
 * (d) Per-component breakdown for the real night.
 *
 * Run: set -a && source .env.local && set +a && npx tsx scripts/score-rework-check.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/db/client";
import { sleepSessions, heartRateSamples } from "@/db/schema";
import { eq, and, gte, lte, asc, desc } from "drizzle-orm";
import { calculateHolisticSleepScore } from "@/lib/analytics/sleep/score";
import { calculateDeepSleepContinuity } from "@/lib/analytics/sleep/continuity";
import { calculateRestlessness, computeDisruptionIndex } from "@/lib/analytics/sleep/restlessness";
import { detectHrRestlessness } from "@/lib/analytics/sleep/hr-restlessness";
import { calculateCardiacStrain } from "@/lib/analytics/sleep/cardiac-strain";
import { calculateHeartAnalytics } from "@/lib/analytics/heart";
import { heartRateSummaries } from "@/db/schema";
import type { SleepStageInterval } from "@/lib/analytics/sleep/types";

const USER_EMAIL = "gisete@gmail.com";
const SLEEP_DATE = "2026-06-11";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scoreBreakdown(label: string, opts: {
  totalSleepMs: number;
  timeInBedMs: number;
  continuityScore: number;
  disruptionIndex: number;
  cardiacScore: number | null;
}) {
  const score = calculateHolisticSleepScore(
    opts.totalSleepMs,
    opts.timeInBedMs,
    opts.continuityScore,
    opts.disruptionIndex,
    opts.cardiacScore
  );
  const volRatio  = Math.min(opts.totalSleepMs / (8 * 3_600_000), 1.0) * 100;
  const effRatio  = Math.min((opts.totalSleepMs / opts.timeInBedMs) / 0.95, 1.0) * 100;
  const W_VOLUME = 0.30, W_EFFICIENCY = 0.15, W_CONTINUITY = 0.20, W_DISRUPTION = 0.20, W_CARDIAC = 0.15;

  const components: Array<{ name: string; score: number; weight: number }> = [
    { name: "Volume",      score: volRatio,             weight: W_VOLUME },
    { name: "Efficiency",  score: effRatio,             weight: W_EFFICIENCY },
    { name: "Continuity",  score: opts.continuityScore, weight: W_CONTINUITY },
    { name: "Disruption",  score: opts.disruptionIndex, weight: W_DISRUPTION },
  ];
  if (opts.cardiacScore !== null) {
    components.push({ name: "Cardiac", score: opts.cardiacScore, weight: W_CARDIAC });
  }
  const totalW = components.reduce((s, c) => s + c.weight, 0);

  console.log(`\n── ${label}  →  Score: ${score}`);
  console.log(`   Components (weights proportionally normalized to ${(totalW * 100).toFixed(0)}%):`);
  for (const c of components) {
    const normalizedW = (c.weight / totalW) * 100;
    const contribution = Math.round((c.score / 100) * (c.weight / totalW) * 100);
    console.log(`   ${c.name.padEnd(12)} ${String(Math.round(c.score)).padStart(3)}/100  ×${normalizedW.toFixed(1)}%  →  ${contribution} pts`);
  }
  console.log(`   ${"".padEnd(12)} ${"".padStart(3)}        total   ${score} / 100`);
  return score;
}

// ---------------------------------------------------------------------------
// Fixture (b): 7.5h consolidated night, mostly below baseline
// ---------------------------------------------------------------------------

function fixtureConsolidated() {
  const totalSleepMs = 7.5 * 3_600_000;   // 7h30m
  const timeInBedMs  = 8.0 * 3_600_000;   // 8h00m in bed
  const continuity   = 80;                  // good deep sleep
  const disruption   = 100;                 // no awakenings/restlessness
  const cardiac      = 100;                 // 70% of night below baseline → strain score 100

  scoreBreakdown("(b) Consolidated 7.5h night, excellent recovery (expect 85+)", {
    totalSleepMs, timeInBedMs, continuityScore: continuity,
    disruptionIndex: disruption, cardiacScore: cardiac,
  });
}

// ---------------------------------------------------------------------------
// Fixture (c): No HR samples — weight redistribution
// ---------------------------------------------------------------------------

function fixtureNoHr() {
  const totalSleepMs = 7.5 * 3_600_000;
  const timeInBedMs  = 8.0 * 3_600_000;
  const continuity   = 70;
  const disruption   = 80;   // one mild awakening
  const cardiac: null = null; // no HR data

  scoreBreakdown("(c) Same 7.5h night but no HR data (cardiac redistributed)", {
    totalSleepMs, timeInBedMs, continuityScore: continuity,
    disruptionIndex: disruption, cardiacScore: cardiac,
  });
}

// ---------------------------------------------------------------------------
// Real night 2026-06-11
// ---------------------------------------------------------------------------

async function realNight() {
  const userRow = await db.query.users.findFirst({
    where: eq((await import("@/db/schema")).users.email, USER_EMAIL),
  });
  if (!userRow) throw new Error(`User not found: ${USER_EMAIL}`);

  // Resolve the 7-day rolling baseline for the wake-up morning (2026-06-12)
  const heartRows = await db.query.heartRateSummaries.findMany({
    where: and(eq(heartRateSummaries.userId, userRow.id), lte(heartRateSummaries.date, "2026-06-12")),
  });
  const heart = calculateHeartAnalytics(heartRows.map(r => ({
    date: r.date, restingHeartRate: r.restingHeartRate, hrvRmssd: r.hrvRmssd,
  })));
  const wakeDay = heart.daily.find(d => d.date === "2026-06-12");
  const baselineRhr = wakeDay?.baselineRhr ?? heart.overallBaseline.avgRhr ?? null;

  const session = await db.query.sleepSessions.findFirst({
    where: and(eq(sleepSessions.userId, userRow.id), eq(sleepSessions.sleepDate, SLEEP_DATE)),
    with: { stages: true },
  });
  if (!session) throw new Error(`No session for ${SLEEP_DATE}`);

  const timeline: SleepStageInterval[] = session.stages
    .map((s) => ({
      stageType: s.stageType,
      startTime: s.startTime.toISOString(),
      endTime: s.endTime.toISOString(),
      durationMs: s.durationMs,
    }))
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  const hrRaw = await db.query.heartRateSamples.findMany({
    where: and(
      eq(heartRateSamples.userId, userRow.id),
      gte(heartRateSamples.timestamp, session.startTime),
      lte(heartRateSamples.timestamp, session.endTime),
    ),
    orderBy: [asc(heartRateSamples.timestamp)],
  });
  const hrSeries = hrRaw.map((s) => ({ timestamp: s.timestamp.getTime(), bpm: s.bpm }));

  // Components
  const continuity     = calculateDeepSleepContinuity(timeline);
  const stageRestless  = calculateRestlessness(timeline);

  const hrEvents = detectHrRestlessness(hrSeries, timeline);
  const restlessMs = hrEvents.reduce((s, e) => s + e.durationMs, 0);
  const disruptionIndex = computeDisruptionIndex(
    hrEvents.length, restlessMs / 60_000,
    stageRestless.awakeningCount, stageRestless.awakeningTotalMinutes
  );

  const cardiacStrain = calculateCardiacStrain(hrSeries, timeline, baselineRhr);

  const timeInBedMs = session.endTime.getTime() - session.startTime.getTime();

  console.log(`\n=== Real night ${SLEEP_DATE} ===`);
  console.log(`  Session:       ${session.startTime.toISOString()} → ${session.endTime.toISOString()}`);
  console.log(`  totalSleepMs:  ${Math.round(session.totalSleepMs / 60_000)}m`);
  console.log(`  timeInBedMs:   ${Math.round(timeInBedMs / 60_000)}m`);
  console.log(`  baselineRhr:   ${baselineRhr} bpm (7-day rolling)`);
  console.log(`  Continuity:    ${continuity.continuityScore} (${continuity.status})`);
  console.log(`  Awakenings:    ${stageRestless.awakeningCount} (${stageRestless.awakeningTotalMinutes}m)`);
  console.log(`  HR events:     ${hrEvents.length} restless (${Math.round(restlessMs / 60_000)}m)`);
  console.log(`  disruptionIdx: ${disruptionIndex}`);
  if (cardiacStrain) {
    console.log(`  Cardiac strain: avgBpm=${cardiacStrain.avgAsleepBpm}, belowPct=${cardiacStrain.timeBelowBaselinePct}%, strainScore=${cardiacStrain.strainRecoveryScore}`);
  } else {
    console.log(`  Cardiac strain: null (< 30 asleep minutes of HR data)`);
  }

  scoreBreakdown("(a) Real 2026-06-11 night (expect 60-75)", {
    totalSleepMs: session.totalSleepMs,
    timeInBedMs,
    continuityScore: continuity.continuityScore,
    disruptionIndex,
    cardiacScore: cardiacStrain?.strainRecoveryScore ?? null,
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n=== Holistic Score Spot-Check ===\n");
  fixtureConsolidated();
  fixtureNoHr();
  await realNight();
  console.log("\n=== Done ===\n");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

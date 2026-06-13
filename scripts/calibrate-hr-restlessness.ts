/**
 * Calibration script: runs detectHrRestlessness against the real 2026-06-11
 * night from the DB. Prints detected events with timestamps so they can be
 * compared against the Fitbit app's "Restlessness · 14 min / ~20 events".
 *
 * Also verifies a flat-bpm fixture yields zero events.
 *
 * Run: set -a && source .env.local && set +a && npx tsx scripts/calibrate-hr-restlessness.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/db/client";
import { sleepSessions, sleepStages, heartRateSamples } from "@/db/schema";
import { eq, and, gte, lte, asc } from "drizzle-orm";
import {
  detectHrRestlessness,
  SPIKE_DELTA_BPM,
  MAX_EVENT_MINUTES,
  BUFFER_MINUTES,
} from "@/lib/analytics/sleep/hr-restlessness";
import type { SleepStageInterval } from "@/lib/analytics/sleep/types";
import { formatClockTime, formatDurationMs } from "@/lib/format";

const USER_EMAIL = "gisete@gmail.com";
const SLEEP_DATE = "2026-06-11";

async function main() {
  console.log("\n=== HR Restlessness Calibration ===");
  console.log(`Thresholds: SPIKE_DELTA_BPM=${SPIKE_DELTA_BPM}, MAX_EVENT_MINUTES=${MAX_EVENT_MINUTES}, BUFFER_MINUTES=${BUFFER_MINUTES}\n`);

  // ---------------------------------------------------------------------------
  // 1. Flat-bpm fixture — must yield zero events
  // ---------------------------------------------------------------------------
  console.log("── Fixture: flat bpm (expect 0 events)");
  const flatSamples = Array.from({ length: 60 }, (_, i) => ({
    timestamp: 1_000_000 + i * 60_000,
    bpm: 55,
  }));
  const flatTimeline: SleepStageInterval[] = [
    { stageType: "light", startTime: new Date(1_000_000).toISOString(), endTime: new Date(1_000_000 + 60 * 60_000).toISOString(), durationMs: 60 * 60_000 },
  ];
  const flatEvents = detectHrRestlessness(flatSamples, flatTimeline);
  console.log(`  Result: ${flatEvents.length} events ${flatEvents.length === 0 ? "✓" : "✗ FAIL"}\n`);

  // Fixture: single spike mid-night (must detect it)
  console.log("── Fixture: one spike at minute 30 (expect 1 event)");
  const spikeSamples = Array.from({ length: 60 }, (_, i) => ({
    timestamp: 1_000_000 + i * 60_000,
    bpm: i === 30 ? 75 : 55, // +20 above median at minute 30
  }));
  const spikeEvents = detectHrRestlessness(spikeSamples, flatTimeline);
  console.log(`  Result: ${spikeEvents.length} events ${spikeEvents.length > 0 ? "✓" : "✗ FAIL"}\n`);

  // ---------------------------------------------------------------------------
  // 2. Real data from DB for 2026-06-11 night
  // ---------------------------------------------------------------------------
  console.log(`── Real data: sleep_date=${SLEEP_DATE}`);

  // Find the user by email
  const userRow = await db.query.users.findFirst({
    where: eq((await import("@/db/schema")).users.email, USER_EMAIL),
  });
  if (!userRow) throw new Error(`User not found: ${USER_EMAIL}`);

  // Find the session for that night
  const session = await db.query.sleepSessions.findFirst({
    where: and(
      eq(sleepSessions.userId, userRow.id),
      eq(sleepSessions.sleepDate, SLEEP_DATE)
    ),
    with: { stages: true },
  });
  if (!session) throw new Error(`No session found for ${SLEEP_DATE}`);

  console.log(`  Session: ${session.startTime.toISOString()} → ${session.endTime.toISOString()}`);
  console.log(`  Stages: ${session.stages.length}`);

  // Build SleepStageInterval array
  const timeline: SleepStageInterval[] = session.stages
    .map((s) => ({
      stageType: s.stageType,
      startTime: s.startTime.toISOString(),
      endTime: s.endTime.toISOString(),
      durationMs: s.durationMs,
    }))
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  // Load HR samples for this session
  const samples = await db.query.heartRateSamples.findMany({
    where: and(
      eq(heartRateSamples.userId, userRow.id),
      gte(heartRateSamples.timestamp, session.startTime),
      lte(heartRateSamples.timestamp, session.endTime),
    ),
    orderBy: [asc(heartRateSamples.timestamp)],
  });

  console.log(`  HR samples: ${samples.length}`);
  if (samples.length < 2) {
    console.log("  Not enough HR samples to run detection.");
    process.exit(0);
  }

  const hrSeries = samples.map((s) => ({ timestamp: s.timestamp.getTime(), bpm: s.bpm }));

  const events = detectHrRestlessness(hrSeries, timeline);

  console.log(`\n  Detected: ${events.length} restless events`);

  const totalMs = events.reduce((s, e) => s + e.durationMs, 0);
  console.log(`  Total duration: ${formatDurationMs(totalMs)}`);

  if (events.length > 0) {
    console.log("\n  Events:");
    events.forEach((e, i) => {
      const ts = new Date(e.startTime).getTime();
      const hourOfNight = Math.round((ts - session.startTime.getTime()) / 3_600_000 * 10) / 10;
      console.log(
        `    ${String(i + 1).padStart(2)}.  ${formatClockTime(e.startTime)}  (${formatDurationMs(e.durationMs)})  ` +
        `[+${hourOfNight}h into night]`
      );
    });

    // Density split: first half vs second half of session
    const midTs = (session.startTime.getTime() + session.endTime.getTime()) / 2;
    const firstHalf = events.filter((e) => new Date(e.startTime).getTime() < midTs).length;
    const secondHalf = events.length - firstHalf;
    console.log(`\n  Density: first half=${firstHalf}, second half=${secondHalf} (want second-half heavy)`);
  }

  // Reference awake blocks for context
  const awakeBlocks = timeline.filter((s) => s.stageType === "awake");
  console.log(`\n  AWAKE stage blocks (${awakeBlocks.length}):`);
  awakeBlocks.forEach((b) => {
    const durMin = Math.round(b.durationMs / 60_000 * 10) / 10;
    console.log(`    ${formatClockTime(b.startTime)} → ${formatClockTime(b.endTime)}  (${durMin}m)`);
  });

  console.log("\n=== Done ===\n");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

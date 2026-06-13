import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/db/client";
import { heartRateSummaries, heartRateSamples, sleepSessions } from "@/db/schema";
import { eq, and, lte, gte, asc } from "drizzle-orm";
import { calculateHeartAnalytics } from "@/lib/analytics/heart";
import { downsampleToMinuteBins } from "@/lib/analytics/sleep/utils";

const USER_EMAIL = "gisete@gmail.com";

async function main() {
  const userRow = await db.query.users.findFirst({
    where: eq((await import("@/db/schema")).users.email, USER_EMAIL),
  });
  if (!userRow) throw new Error("User not found");

  // Heart summaries for rolling baseline
  const heartRows = await db.query.heartRateSummaries.findMany({
    where: and(
      eq(heartRateSummaries.userId, userRow.id),
      lte(heartRateSummaries.date, "2026-06-12")
    ),
    orderBy: [heartRateSummaries.date],
  });
  const heart = calculateHeartAnalytics(heartRows.map(r => ({
    date: r.date,
    restingHeartRate: r.restingHeartRate,
    hrvRmssd: r.hrvRmssd,
  })));
  const wakeDay = heart.daily.find(d => d.date === "2026-06-12");
  console.log("Wake day (2026-06-12):", wakeDay);
  console.log("Overall baseline avgRhr:", heart.overallBaseline.avgRhr);

  // Sleep session
  const session = await db.query.sleepSessions.findFirst({
    where: and(eq(sleepSessions.userId, userRow.id), eq(sleepSessions.sleepDate, "2026-06-11")),
    with: { stages: true },
  });
  if (!session) throw new Error("No session");

  // HR samples for the night
  const hrRaw = await db.query.heartRateSamples.findMany({
    where: and(
      eq(heartRateSamples.userId, userRow.id),
      gte(heartRateSamples.timestamp, session.startTime),
      lte(heartRateSamples.timestamp, session.endTime),
    ),
    orderBy: [asc(heartRateSamples.timestamp)],
  });

  const binned = downsampleToMinuteBins(hrRaw.map(s => ({ timestamp: s.timestamp.getTime(), bpm: s.bpm })));
  const bpms = binned.map(s => s.bpm);
  console.log(`\nHR samples: ${hrRaw.length} raw → ${binned.length} binned`);
  console.log(`bpm range: ${Math.min(...bpms)} – ${Math.max(...bpms)}`);
  console.log(`bpm mean: ${(bpms.reduce((a, b) => a + b, 0) / bpms.length).toFixed(1)}`);
  console.log(`bpm p25: ${bpms.sort((a,b)=>a-b)[Math.floor(bpms.length*0.25)]}`);
  console.log(`bpm p50: ${bpms.sort((a,b)=>a-b)[Math.floor(bpms.length*0.50)]}`);
  console.log(`bpm p75: ${bpms.sort((a,b)=>a-b)[Math.floor(bpms.length*0.75)]}`);

  // Non-awake periods
  const sleepIntervals = session.stages
    .filter(s => s.stageType !== "awake")
    .map(s => ({ startMs: s.startTime.getTime(), endMs: s.endTime.getTime() }));
  const asleepBinned = binned.filter(s =>
    sleepIntervals.some(iv => s.timestamp >= iv.startMs && s.timestamp < iv.endMs)
  );
  const asleepBpms = asleepBinned.map(s => s.bpm).sort((a, b) => a - b);
  console.log(`\nAsleep (non-awake) bins: ${asleepBinned.length}`);
  if (asleepBpms.length > 0) {
    console.log(`asleep bpm range: ${asleepBpms[0]} – ${asleepBpms[asleepBpms.length-1]}`);
    console.log(`asleep bpm mean: ${(asleepBpms.reduce((a,b)=>a+b,0)/asleepBpms.length).toFixed(1)}`);
    console.log(`asleep bpm p50: ${asleepBpms[Math.floor(asleepBpms.length*0.50)]}`);
    console.log("First 20 asleep bpms:", asleepBpms.slice(0, 20));
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

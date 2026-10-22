import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { syncFromGoogle, readDashboardData } from "@/app/actions/sync";
import { runRangeSync, type RangeSyncResult } from "@/lib/sync/range-sync";
import { auth } from "@/auth";

/** Upper bound for ?days=N so one request can't run an unbounded number of Google chunks. */
const MAX_RANGE_DAYS = 365;

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized. Please log in first." },
        { status: 401 }
      );
    }

    // ?days is a recovery-only escape hatch for DB wipes / first-time backfill:
    // today-N..today, chunked, with per-chunk results in the response. Without
    // it, one forced recent-window step (what the Sync button does).
    const { searchParams } = new URL(request.url);
    const rawDays = searchParams.get("days");
    let rangeSync: RangeSyncResult | undefined;
    if (rawDays !== null) {
      const days = Number(rawDays);
      if (!Number.isInteger(days) || days < 1 || days > MAX_RANGE_DAYS) {
        return NextResponse.json({ error: `days must be an integer from 1 to ${MAX_RANGE_DAYS}.` }, { status: 400 });
      }
      rangeSync = await runRangeSync(session.user.id, days);
      revalidatePath("/dashboard");
      revalidatePath("/dashboard/sleep");
      revalidatePath("/dashboard/heart");
      revalidatePath("/dashboard/today");
      if (!rangeSync.ok) {
        const busy = rangeSync.chunks.some((c) => c.status === "busy");
        const status = rangeSync.authRequired ? 401 : busy ? 409 : 502;
        return NextResponse.json({ error: "Sync did not complete (earlier chunks may have been saved); see sync.chunks.", sync: rangeSync }, { status });
      }
    } else {
      await syncFromGoogle();
    }

    const result = await readDashboardData();

    if (!result.hasData) {
      return NextResponse.json(
        {
          sleep: { hasData: false, message: result.message },
          heart: null,
          sync: rangeSync,
        },
        { status: 200 }
      );
    }

    // Explicit envelope so the mobile client has a stable, versioned contract.
    // Both sections are always present; heart fields are null when no
    // cardiovascular data has been ingested yet.
    return NextResponse.json(
      {
        sleep: {
          hasData: true,
          latestSummary: result.latestSummary,
          chartTimeline: result.chartTimeline,
          analytics: result.analytics,
        },
        heart: result.heart,
        sync: rangeSync,
      },
      { status: 200 }
    );

  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error during synchronization.";
    console.error("[api/sync]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

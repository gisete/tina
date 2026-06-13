import { NextResponse } from "next/server";
import { syncFromGoogle, readDashboardData } from "@/app/actions/sync";
import { auth } from "@/auth";

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized. Please log in first." },
        { status: 401 }
      );
    }

    // ?days is a recovery-only escape hatch for DB wipes / first-time backfill.
    // Normal page loads and the Sync button always use the 3-day default.
    const { searchParams } = new URL(request.url);
    const rawDays = searchParams.get("days");
    const days = rawDays ? Math.max(1, parseInt(rawDays, 10)) : undefined;

    await syncFromGoogle(days !== undefined ? { days } : undefined);
    const result = await readDashboardData();

    if (!result.hasData) {
      return NextResponse.json(
        {
          sleep: { hasData: false, message: result.message },
          heart: null,
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

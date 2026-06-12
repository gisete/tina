import { NextResponse } from "next/server";
import { syncAndFetchSleepAnalytics } from "@/app/actions/sync";
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

    const { searchParams } = new URL(request.url);
    const daysToSync = parseInt(searchParams.get("days") ?? "30", 10);

    const result = await syncAndFetchSleepAnalytics(daysToSync);

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
    // Both sections are always present; heart fields are null when no cardiovascular
    // data has been ingested yet.
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
    const message = error instanceof Error ? error.message : "Internal server error during synchronization.";
    console.error("[api/sync]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

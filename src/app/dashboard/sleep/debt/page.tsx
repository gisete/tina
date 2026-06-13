"use server";

import { Suspense } from "react";
import Link from "next/link";
import { auth } from "@/auth";
import { fetchDebtSessions } from "@/app/actions/sync";
import DebtChart from "./debt-chart";

export default async function SleepDebtPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) return null;

  // Acknowledge searchParams to satisfy Next.js dynamic rendering
  await searchParams;

  let debtData: Awaited<ReturnType<typeof fetchDebtSessions>> | null = null;
  try {
    debtData = await fetchDebtSessions(90);
  } catch (error) {
    console.error("Debt page error:", error);
  }

  const severityClass =
    debtData?.currentSeverity === "high"     ? "bg-red-100 text-red-700" :
    debtData?.currentSeverity === "moderate" ? "bg-amber-100 text-amber-700" :
    "bg-surface-container text-on-surface-variant";

  return (
    <div className="p-margin-mobile md:p-margin-desktop max-w-7xl mx-auto py-10 pb-24 space-y-6">

      {/* Back link */}
      <Link
        href="/dashboard/sleep"
        className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
      >
        ← Sleep
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <h1 className="font-display text-4xl font-bold text-black mb-2 tracking-tight">Sleep Debt</h1>
          <p className="text-base text-on-surface-variant max-w-xl">
            Decay-weighted deficit over the last 14 nights. Recent bad nights weigh more; a surplus night
            recovers debt at half-efficiency.
          </p>
        </div>

        {debtData && (
          <div className="flex items-baseline gap-3">
            <span className="font-display text-4xl font-bold text-on-surface tracking-tight">
              {debtData.currentDebtHours}
              <span className="text-xl font-normal text-on-surface-variant ml-1">hrs</span>
            </span>
            <span className={`px-3 py-1 text-sm font-semibold rounded-full ${severityClass}`}>
              {debtData.currentSeverity}
            </span>
          </div>
        )}
      </div>

      {/* Chart card */}
      <div className="bg-white border border-outline-variant rounded-[1.5rem] p-card-padding">
        <div className="mb-6">
          <h2 className="font-display text-xl font-bold text-on-surface tracking-tight">Debt Timeline</h2>
          <p className="text-sm text-on-surface-variant mt-1">
            Line = decayed running debt. Bars = each night&apos;s surplus or deficit.
          </p>
        </div>

        {!debtData || debtData.history.length === 0 ? (
          <div className="flex items-center justify-center h-[320px] text-sm text-on-surface-variant">
            No sleep data available.
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-[320px] text-sm text-on-surface-variant">
                Loading chart…
              </div>
            }
          >
            <DebtChart history={debtData.history} />
          </Suspense>
        )}
      </div>

      {/* Methodology note */}
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4 text-xs text-on-surface-variant space-y-1 max-w-2xl">
        <p><strong className="text-on-surface">How debt is calculated:</strong></p>
        <p>Each night&apos;s deficit (target − actual) or surplus is weighted by 0.5<sup>(age / 4 days)</sup>. A 4-day-old night contributes half as much pressure as last night. Surplus nights recover debt at 50% efficiency — you can&apos;t fully &quot;bank&quot; sleep.</p>
        <p>Severity: &lt; 5 hrs = optimal · 5–10 hrs = moderate · &gt; 10 hrs = high.</p>
      </div>

    </div>
  );
}

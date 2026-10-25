"use server";

import { PageShell, PageTitle } from "../../components/page-shell";
import { Suspense } from "react";
import Link from "next/link";
import { auth } from "@/auth";
import { fetchDebtSessions } from "@/app/actions/sync";
import DebtChart from "./debt-chart";
import { formatDebtBasis } from "@/lib/format";
import { EYEBROW, EmptyStateCard, NeutralCard, StatCard, StatValue } from "../../components/stat-card";

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

  const debtBasis = debtData ? formatDebtBasis(debtData.nightsUsed, debtData.windowSpanDays) : null;

  const severityClass =
    debtData?.currentSeverity === "high"     ? "bg-red-100 text-red-700" :
    debtData?.currentSeverity === "moderate" ? "bg-amber-100 text-amber-700" :
    "bg-white text-sleep-ink";

  return (
    <PageShell>

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
          <PageTitle className="mb-2">Sleep Debt</PageTitle>
          <p className="text-base text-on-surface-variant max-w-xl">
            Decay-weighted deficit over the last 14 recorded nights. Recent bad nights weigh more; a surplus night
            recovers debt at half-efficiency.
          </p>
        </div>

        {debtData && (
          <StatCard
            tone="sleep"
            eyebrow="Current debt"
            className="w-full md:w-72"
            topRight={<span className={`shrink-0 rounded-full px-2.5 py-[3px] text-xs font-medium ${severityClass}`}>{debtData.currentSeverity}</span>}
          >
            <StatValue tone="sleep" size="tile" value={String(debtData.currentDebtHours)} unit="hrs" caption={debtBasis ?? undefined} />
          </StatCard>
        )}
      </div>

      {/* Chart card */}
      {!debtData || debtData.history.length === 0 ? (
        <EmptyStateCard eyebrow="Debt timeline" className="min-h-[320px]">
          <p className="text-sm text-on-surface-variant">No sleep data available.</p>
        </EmptyStateCard>
      ) : (
        <NeutralCard>
          <div className="mb-6">
            <h2 className={`${EYEBROW} text-on-surface-variant`}>Debt timeline</h2>
            <p className="mt-1.5 text-sm text-on-surface-variant">
              Line = decayed running debt. Bars = each night&apos;s surplus or deficit.
            </p>
          </div>
          <Suspense
            fallback={
              <div className="flex h-[320px] items-center justify-center text-sm text-on-surface-variant">
                Loading chart…
              </div>
            }
          >
            <DebtChart history={debtData.history} />
          </Suspense>
        </NeutralCard>
      )}

      {/* Methodology note */}
      <NeutralCard className="max-w-2xl space-y-1 text-sm text-on-surface-variant">
        <p><strong className="text-on-surface">How debt is calculated:</strong></p>
        <p>Each night&apos;s deficit (target − actual) or surplus is weighted by 0.5<sup>(age / 4 days)</sup>. A 4-day-old night contributes half as much pressure as last night. Surplus nights recover debt at 50% efficiency — you can&apos;t fully &quot;bank&quot; sleep.</p>
        <p>Severity: &lt; 5 hrs = optimal · 5–10 hrs = moderate · &gt; 10 hrs = high.</p>
      </NeutralCard>

    </PageShell>
  );
}

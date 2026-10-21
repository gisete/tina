import type { StepsSummary } from "@/lib/today/read";

const formatSteps = (n: number): string => n.toLocaleString("en-US");

export default function StepsCard({ steps }: { steps: StepsSummary }) {
  return (
    <div className="bg-white border border-outline-variant rounded-[1.5rem] p-card-padding">
      <h2 className="font-display text-xl font-bold text-on-surface tracking-tight mb-3">Steps</h2>
      <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Yesterday</p>
      <p className="font-display text-4xl font-bold text-on-surface tracking-tight">
        {steps.yesterday === null ? "—" : formatSteps(steps.yesterday)}
      </p>
      <p className="mt-2 text-sm text-on-surface-variant">
        {steps.today === null ? "Today: no data yet" : `Today so far: ${formatSteps(steps.today)}`}
      </p>
    </div>
  );
}

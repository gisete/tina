import type { StepsSummary } from "@/lib/today/read";
import { StatCard, StatValue } from "../../components/stat-card";

const formatSteps = (n: number): string => n.toLocaleString("en-US");

export default function StepsCard({ steps, className = "" }: { steps: StepsSummary; className?: string }) {
  return (
    <StatCard tone="activity" eyebrow="Steps · yesterday" className={className}>
      <StatValue
        tone="activity"
        size="tile"
        value={steps.yesterday === null ? "—" : formatSteps(steps.yesterday)}
        unit={steps.yesterday === null ? undefined : "steps"}
        caption={steps.today === null ? "Today: no data yet" : `Today so far: ${formatSteps(steps.today)}`}
      />
    </StatCard>
  );
}

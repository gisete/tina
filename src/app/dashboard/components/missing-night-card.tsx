import { formatNightRange } from "@/lib/format";
import { EmptyStateCard } from "./stat-card";

interface Props {
  /** The night the picked date implies ("YYYY-MM-DD" night-start date). */
  expectedNightOf: string;
  /** True when the picked date is today, i.e. last night may just not have synced yet. */
  isToday: boolean;
}

export default function MissingNightCard({ expectedNightOf, isToday }: Props) {
  return (
    <EmptyStateCard eyebrow={formatNightRange(expectedNightOf)}>
      <div>
        <p className="text-xl text-on-surface">{isToday ? "Last night is missing" : "No sleep recorded for this night"}</p>
        <p className="mt-1.5 text-sm text-on-surface-variant">
          Nothing synced for this night yet. Make sure your watch has synced to its phone app, then press Sync.
        </p>
      </div>
    </EmptyStateCard>
  );
}

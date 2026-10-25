import ExpandableCard from "../../components/expandable-card";
import { EYEBROW, NeutralCard } from "../../components/stat-card";
import type { MindsetItem } from "@/lib/today/types";

export function Mantras({ items }: { items: MindsetItem[] }) {
  if (items.length === 0) return null;
  return (
    <NeutralCard>
      <h2 className={`${EYEBROW} mb-4 text-on-surface-variant`}>Mantras</h2>
      <ul className="space-y-2">
        {items.map((m) => (
          <li key={m.id} className="text-sm text-on-surface">{m.text}</li>
        ))}
      </ul>
    </NeutralCard>
  );
}

export function Strategies({ items }: { items: MindsetItem[] }) {
  if (items.length === 0) return null;
  return (
    <ExpandableCard
      title="Strategies"
      overview={<p className="text-sm text-on-surface-variant">{items.length} to draw on when things get hard</p>}
    >
      <ul className="space-y-2">
        {items.map((m) => (
          <li key={m.id} className="text-sm text-on-surface">{m.text}</li>
        ))}
      </ul>
    </ExpandableCard>
  );
}

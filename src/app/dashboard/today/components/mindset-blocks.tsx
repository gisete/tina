import ExpandableCard from "../../components/expandable-card";
import type { MindsetItem } from "@/lib/today/types";

export function Mantras({ items }: { items: MindsetItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="bg-white border border-outline-variant rounded-[1.5rem] p-card-padding">
      <h2 className="font-display text-xl font-bold text-on-surface tracking-tight mb-3">Mantras</h2>
      <ul className="space-y-2">
        {items.map((m) => (
          <li key={m.id} className="text-sm text-on-surface">{m.text}</li>
        ))}
      </ul>
    </div>
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

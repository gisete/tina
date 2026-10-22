import { formatNightRange } from "@/lib/format";

/** Muted caption marking a figure as belonging to an older night, not last night. */
export default function LastRecordedNightTag({ nightOf }: { nightOf: string }) {
  return (
    <span className="ml-1.5 opacity-70">· {formatNightRange(nightOf)} · last recorded night</span>
  );
}

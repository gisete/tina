"use client";

import { useState } from "react";
import { addExerciseItem, editExerciseItem, moveExerciseItem, removeExerciseItem } from "@/app/actions/plan";
import type { ExercisePlanItem, IsoWeekday } from "@/lib/today/types";
import { Empty, ErrorLine, FieldsForm, IconButton, Row, WeekdayTabs, weekdayName, useRun, type Field } from "./plan-ui";

const FIELDS: Field[] = [
  { name: "name", label: "Exercise", placeholder: "Squats" },
  { name: "details", label: "Details (optional)", placeholder: "3×12 or 20 min", width: "w-44" },
];

export default function WorkoutsSection({ items }: { items: ExercisePlanItem[] }) {
  const [weekday, setWeekday] = useState<IsoWeekday>(1);
  const [editingId, setEditingId] = useState<number | null>(null);
  const { run, pending, error } = useRun();

  const counts: Partial<Record<IsoWeekday, number>> = {};
  for (const i of items) counts[i.weekday] = (counts[i.weekday] ?? 0) + 1;
  const dayItems = items.filter((i) => i.weekday === weekday);

  return (
    <div>
      <WeekdayTabs value={weekday} onChange={(d) => { setWeekday(d); setEditingId(null); }} counts={counts} />
      {dayItems.length === 0 ? (
        <Empty>Nothing planned for {weekdayName(weekday)} yet.</Empty>
      ) : (
        <ul>
          {dayItems.map((item, idx) =>
            editingId === item.id ? (
              <li key={item.id}>
                <FieldsForm
                  fields={FIELDS}
                  initial={{ name: item.name, details: item.details ?? "" }}
                  submitLabel="Save"
                  pending={pending}
                  onCancel={() => setEditingId(null)}
                  onSubmit={(v, done) => run(() => editExerciseItem({ id: item.id, name: v.name, details: v.details }), done)}
                />
              </li>
            ) : (
              <Row
                key={item.id}
                actions={
                  <>
                    <IconButton label="Move up" disabled={pending || idx === 0} onClick={() => run(() => moveExerciseItem(item.id, "up"))}>▲</IconButton>
                    <IconButton label="Move down" disabled={pending || idx === dayItems.length - 1} onClick={() => run(() => moveExerciseItem(item.id, "down"))}>▼</IconButton>
                    <IconButton label="Edit" onClick={() => setEditingId(item.id)}>Edit</IconButton>
                    <IconButton label="Delete" disabled={pending} onClick={() => run(() => removeExerciseItem(item.id))}>✕</IconButton>
                  </>
                }
              >
                <span className="font-semibold">{item.name}</span>
                {item.details && <span className="text-on-surface-variant"> · {item.details}</span>}
              </Row>
            ),
          )}
        </ul>
      )}
      <FieldsForm
        fields={FIELDS}
        submitLabel={`Add to ${weekdayName(weekday)}`}
        pending={pending}
        onSubmit={(v, done) => run(() => addExerciseItem({ weekday, name: v.name, details: v.details }), done)}
      />
      <ErrorLine error={error} />
    </div>
  );
}

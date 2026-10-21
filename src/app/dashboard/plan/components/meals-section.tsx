"use client";

import { useState } from "react";
import { addMealItem, copyMealDay, editMealItem, moveMealItem, removeMealItem } from "@/app/actions/plan";
import { MEAL_SLOTS, type IsoWeekday, type MealPlanItem, type MealSlot } from "@/lib/today/types";
import { Empty, ErrorLine, FieldsForm, IconButton, Row, SubHeading, WeekdayTabs, weekdayName, useRun, type Field } from "./plan-ui";

const FIELDS: Field[] = [{ name: "description", label: "Meal", placeholder: "Oats with berries" }];
const SLOT_LABEL: Record<MealSlot, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };

export default function MealsSection({ items }: { items: MealPlanItem[] }) {
  const [weekday, setWeekday] = useState<IsoWeekday>(1);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [confirmingCopy, setConfirmingCopy] = useState(false);
  const { run, pending, error } = useRun();

  const counts: Partial<Record<IsoWeekday, number>> = {};
  for (const i of items) counts[i.weekday] = (counts[i.weekday] ?? 0) + 1;
  const dayItems = items.filter((i) => i.weekday === weekday);

  return (
    <div>
      <WeekdayTabs value={weekday} onChange={(d) => { setWeekday(d); setEditingId(null); setConfirmingCopy(false); }} counts={counts} />

      {MEAL_SLOTS.map((slot) => {
        const slotItems = dayItems.filter((i) => i.slot === slot);
        return (
          <section key={slot}>
            <SubHeading>{SLOT_LABEL[slot]}</SubHeading>
            {slotItems.length === 0 ? (
              <Empty>Nothing planned.</Empty>
            ) : (
              <ul>
                {slotItems.map((item, idx) =>
                  editingId === item.id ? (
                    <li key={item.id}>
                      <FieldsForm
                        fields={FIELDS}
                        initial={{ description: item.description }}
                        submitLabel="Save"
                        pending={pending}
                        onCancel={() => setEditingId(null)}
                        onSubmit={(v, done) => run(() => editMealItem({ id: item.id, description: v.description }), done)}
                      />
                    </li>
                  ) : (
                    <Row
                      key={item.id}
                      actions={
                        <>
                          <IconButton label="Move up" disabled={pending || idx === 0} onClick={() => run(() => moveMealItem(item.id, "up"))}>▲</IconButton>
                          <IconButton label="Move down" disabled={pending || idx === slotItems.length - 1} onClick={() => run(() => moveMealItem(item.id, "down"))}>▼</IconButton>
                          <IconButton label="Edit" onClick={() => setEditingId(item.id)}>Edit</IconButton>
                          <IconButton label="Delete" disabled={pending} onClick={() => run(() => removeMealItem(item.id))}>✕</IconButton>
                        </>
                      }
                    >
                      {item.description}
                    </Row>
                  ),
                )}
              </ul>
            )}
            <FieldsForm
              fields={FIELDS}
              submitLabel={`Add ${SLOT_LABEL[slot].toLowerCase()}`}
              pending={pending}
              onSubmit={(v, done) => run(() => addMealItem({ weekday, slot, description: v.description }), done)}
            />
          </section>
        );
      })}

      <div className="mt-6 pt-4 border-t border-outline-variant/50">
        {confirmingCopy ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-on-surface">
              Replace every other day&apos;s meals with {weekdayName(weekday)}&apos;s? Past logs keep their text.
            </span>
            <button
              disabled={pending}
              onClick={() => run(() => copyMealDay(weekday), () => setConfirmingCopy(false))}
              className="rounded-xl bg-on-surface text-white px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-50"
            >
              Replace
            </button>
            <button
              onClick={() => setConfirmingCopy(false)}
              className="rounded-xl border border-outline-variant px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-surface-container"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            disabled={dayItems.length === 0}
            onClick={() => setConfirmingCopy(true)}
            className="rounded-xl border border-outline-variant px-4 py-2 text-sm font-semibold text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors disabled:opacity-40"
          >
            Copy {weekdayName(weekday)} to all days
          </button>
        )}
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

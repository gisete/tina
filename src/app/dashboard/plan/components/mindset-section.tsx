"use client";

import { useState } from "react";
import { addMindsetItem, editMindsetItem, moveMindsetItem, removeMindsetItem } from "@/app/actions/plan";
import type { MindsetItem, MindsetKind } from "@/lib/today/types";
import { Empty, ErrorLine, FieldsForm, IconButton, Row, SubHeading, useRun, type Field } from "./plan-ui";

const FIELDS: Field[] = [{ name: "text", label: "Text" }];

function MindsetList({ kind, heading, items }: { kind: MindsetKind; heading: string; items: MindsetItem[] }) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const { run, pending, error } = useRun();

  return (
    <section>
      <SubHeading>{heading}</SubHeading>
      {items.length === 0 ? <Empty>None yet.</Empty> : (
        <ul>
          {items.map((item, idx) =>
            editingId === item.id ? (
              <li key={item.id}>
                <FieldsForm
                  fields={FIELDS}
                  initial={{ text: item.text }}
                  submitLabel="Save"
                  pending={pending}
                  onCancel={() => setEditingId(null)}
                  onSubmit={(v, done) => run(() => editMindsetItem({ id: item.id, text: v.text }), done)}
                />
              </li>
            ) : (
              <Row
                key={item.id}
                actions={
                  <>
                    <IconButton label="Move up" disabled={pending || idx === 0} onClick={() => run(() => moveMindsetItem(item.id, "up"))}>▲</IconButton>
                    <IconButton label="Move down" disabled={pending || idx === items.length - 1} onClick={() => run(() => moveMindsetItem(item.id, "down"))}>▼</IconButton>
                    <IconButton label="Edit" onClick={() => setEditingId(item.id)}>Edit</IconButton>
                    <IconButton label="Delete" disabled={pending} onClick={() => run(() => removeMindsetItem(item.id))}>✕</IconButton>
                  </>
                }
              >
                {item.text}
              </Row>
            ),
          )}
        </ul>
      )}
      <FieldsForm
        fields={FIELDS}
        submitLabel={`Add ${kind}`}
        pending={pending}
        onSubmit={(v, done) => run(() => addMindsetItem({ kind, text: v.text }), done)}
      />
      <ErrorLine error={error} />
    </section>
  );
}

export default function MindsetSection({ items }: { items: MindsetItem[] }) {
  return (
    <div>
      <MindsetList kind="mantra" heading="Mantras" items={items.filter((i) => i.kind === "mantra")} />
      <MindsetList kind="strategy" heading="Strategies" items={items.filter((i) => i.kind === "strategy")} />
    </div>
  );
}

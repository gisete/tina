"use client";

import { useState } from "react";
import { addMotivationLine, editMotivationLine, removeMotivationLine, toggleMotivationLine } from "@/app/actions/plan";
import type { MotivationLine } from "@/lib/today/types";
import { Empty, ErrorLine, FieldsForm, IconButton, Row, useRun, type Field } from "./plan-ui";

const FIELDS: Field[] = [{ name: "text", label: "Line" }];

export default function MotivationSection({ lines }: { lines: MotivationLine[] }) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const { run, pending, error } = useRun();

  return (
    <div>
      <p className="text-sm text-on-surface-variant mb-2">One active line is shown each day, chosen by date.</p>
      {lines.length === 0 ? <Empty>No lines yet.</Empty> : (
        <ul>
          {lines.map((line) =>
            editingId === line.id ? (
              <li key={line.id}>
                <FieldsForm
                  fields={FIELDS}
                  initial={{ text: line.text }}
                  submitLabel="Save"
                  pending={pending}
                  onCancel={() => setEditingId(null)}
                  onSubmit={(v, done) => run(() => editMotivationLine({ id: line.id, text: v.text }), done)}
                />
              </li>
            ) : (
              <Row
                key={line.id}
                muted={!line.active}
                actions={
                  <>
                    <IconButton label={line.active ? "Pause line" : "Activate line"} disabled={pending} onClick={() => run(() => toggleMotivationLine(line.id, !line.active))}>
                      {line.active ? "Pause" : "Activate"}
                    </IconButton>
                    <IconButton label="Edit" onClick={() => setEditingId(line.id)}>Edit</IconButton>
                    <IconButton label="Delete" disabled={pending} onClick={() => run(() => removeMotivationLine(line.id))}>✕</IconButton>
                  </>
                }
              >
                {line.text}
                {!line.active && <span className="text-on-surface-variant"> (paused)</span>}
              </Row>
            ),
          )}
        </ul>
      )}
      <FieldsForm
        fields={FIELDS}
        submitLabel="Add line"
        pending={pending}
        onSubmit={(v, done) => run(() => addMotivationLine(v.text), done)}
      />
      <ErrorLine error={error} />
    </div>
  );
}

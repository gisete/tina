"use client";

import { useState } from "react";
import {
  addCondition, addConditionOption, archiveCondition, archiveConditionOption, editCondition, editConditionOption,
} from "@/app/actions/plan";
import { parseOptionalNumber } from "@/lib/today/validate";
import type { ConditionOption, ConditionWithOptions } from "@/lib/today/types";
import { Empty, ErrorLine, FieldsForm, IconButton, Row, SubHeading, useRun, type Field } from "./plan-ui";

const CONDITION_FIELDS: Field[] = [
  { name: "name", label: "Condition", placeholder: "Low energy" },
  { name: "threshold", label: "Suggest when sleep score below (optional)", type: "number", placeholder: "70", width: "w-56" },
];
const OPTION_FIELDS: Field[] = [
  { name: "name", label: "Option", placeholder: "20 min walk" },
  { name: "details", label: "Details (optional)", placeholder: "easy pace", width: "w-44" },
];

function OptionRows({ condition }: { condition: ConditionWithOptions }) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const { run, pending, error } = useRun();

  const renderOption = (o: ConditionOption) =>
    editingId === o.id ? (
      <li key={o.id}>
        <FieldsForm
          fields={OPTION_FIELDS}
          initial={{ name: o.name, details: o.details ?? "" }}
          submitLabel="Save"
          pending={pending}
          onCancel={() => setEditingId(null)}
          onSubmit={(v, done) => run(() => editConditionOption({ id: o.id, name: v.name, details: v.details }), done)}
        />
      </li>
    ) : (
      <Row
        key={o.id}
        muted={o.archived}
        actions={
          <>
            {!o.archived && <IconButton label="Edit option" onClick={() => setEditingId(o.id)}>Edit</IconButton>}
            <IconButton label={o.archived ? "Restore option" : "Archive option"} disabled={pending} onClick={() => run(() => archiveConditionOption(o.id, !o.archived))}>
              {o.archived ? "Restore" : "Archive"}
            </IconButton>
          </>
        }
      >
        {o.name}
        {o.details && <span className="text-on-surface-variant"> · {o.details}</span>}
        {o.archived && <span className="text-on-surface-variant"> (archived)</span>}
      </Row>
    );

  return (
    <div className="mt-2 pl-4 border-l border-outline-variant/50">
      <SubHeading>Options</SubHeading>
      {condition.options.length === 0 ? <Empty>No options yet.</Empty> : <ul>{condition.options.map(renderOption)}</ul>}
      <FieldsForm
        fields={OPTION_FIELDS}
        submitLabel="Add option"
        pending={pending}
        onSubmit={(v, done) => run(() => addConditionOption({ conditionId: condition.id, name: v.name, details: v.details }), done)}
      />
      <ErrorLine error={error} />
    </div>
  );
}

function ConditionBlock({ condition }: { condition: ConditionWithOptions }) {
  const [editing, setEditing] = useState(false);
  const { run, pending, error } = useRun();

  return (
    <li className={`py-4 border-b border-outline-variant/50 last:border-b-0 ${condition.archived ? "opacity-60" : ""}`}>
      {editing ? (
        <FieldsForm
          fields={CONDITION_FIELDS}
          initial={{ name: condition.name, threshold: condition.sleepScoreBelow?.toString() ?? "" }}
          submitLabel="Save"
          pending={pending}
          onCancel={() => setEditing(false)}
          onSubmit={(v, done) =>
            run(() => editCondition({ id: condition.id, name: v.name, sleepScoreBelow: parseOptionalNumber(v.threshold) }), done)
          }
        />
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div className="text-sm text-on-surface">
            <span className="font-semibold">{condition.name}</span>
            {condition.archived && <span className="text-on-surface-variant"> (archived)</span>}
            {condition.sleepScoreBelow !== null && (
              <p className="text-xs text-on-surface-variant mt-0.5">Suggested when sleep score is below {condition.sleepScoreBelow}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center">
            {!condition.archived && <IconButton label="Edit condition" onClick={() => setEditing(true)}>Edit</IconButton>}
            <IconButton label={condition.archived ? "Restore condition" : "Archive condition"} disabled={pending} onClick={() => run(() => archiveCondition(condition.id, !condition.archived))}>
              {condition.archived ? "Restore" : "Archive"}
            </IconButton>
          </div>
        </div>
      )}
      <ErrorLine error={error} />
      {!condition.archived && <OptionRows condition={condition} />}
    </li>
  );
}

export default function ConditionsSection({ conditions }: { conditions: ConditionWithOptions[] }) {
  const { run, pending, error } = useRun();
  const active = conditions.filter((c) => !c.archived);
  const archived = conditions.filter((c) => c.archived);

  return (
    <div>
      {active.length === 0 ? <Empty>No conditions yet. Add one to build a backup workout menu.</Empty> : (
        <ul>{active.map((c) => <ConditionBlock key={c.id} condition={c} />)}</ul>
      )}
      <FieldsForm
        fields={CONDITION_FIELDS}
        submitLabel="Add condition"
        pending={pending}
        onSubmit={(v, done) => run(() => addCondition({ name: v.name, sleepScoreBelow: parseOptionalNumber(v.threshold) }), done)}
      />
      <ErrorLine error={error} />
      {archived.length > 0 && (
        <>
          <SubHeading>Archived</SubHeading>
          <ul>{archived.map((c) => <ConditionBlock key={c.id} condition={c} />)}</ul>
        </>
      )}
    </div>
  );
}

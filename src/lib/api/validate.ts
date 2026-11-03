// Runtime validation of API responses against the contract — pure, no deps.
// Used by the contract smoke test (and fixtures). Returns human-readable errors;
// an empty array means the value conforms.

import { SCHEMA_DOC, type FieldDoc } from "./schema-doc";

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const METRIC_STATUSES = ["measured", "estimated", "derived", "unavailable"];
const FLAGS = Object.keys(SCHEMA_DOC.metricFlags);
const REASONS = Object.keys(SCHEMA_DOC.unavailableReasons);
const ERROR_CODES = Object.keys(SCHEMA_DOC.errorCodes);

const isRecord = (v: Json | undefined): v is { [k: string]: Json } => v !== null && typeof v === "object" && !Array.isArray(v);

export interface FieldSeen {
  path: string;
  /** The raw leaf value for non-metric leaves (null for metrics). */
  value: Json;
  /** The metric unit when the node is a present metric; otherwise null. */
  unit: string | null;
  isMetric: boolean;
}

/** Every leaf of a payload as a dotted path ("[]" marks array elements); metric objects are one leaf. */
export function walkFields(v: Json, path = "", out: FieldSeen[] = []): FieldSeen[] {
  if (Array.isArray(v)) {
    for (const e of v) walkFields(e, `${path}[]`, out);
    return out;
  }
  if (isRecord(v)) {
    if (typeof v.status === "string" && METRIC_STATUSES.includes(v.status)) {
      out.push({ path, value: null, unit: v.status !== "unavailable" && typeof v.unit === "string" ? v.unit : null, isMetric: true });
      return out;
    }
    for (const [k, child] of Object.entries(v)) walkFields(child, path ? `${path}.${k}` : k, out);
    return out;
  }
  out.push({ path, value: v, unit: null, isMetric: false });
  return out;
}

/** Checks one metric object's shape: the discriminated union, finite numbers, known reasons and flags. */
export function validateMetric(m: { [k: string]: Json }, where: string): string[] {
  const errs: string[] = [];
  const status = m.status;
  if (status === "unavailable") {
    if (typeof m.reason !== "string" || !REASONS.includes(m.reason)) errs.push(`${where}: unavailable needs a known reason, got ${JSON.stringify(m.reason)}`);
    if ("value" in m) errs.push(`${where}: unavailable must not carry a value`);
    return errs;
  }
  if (typeof m.value !== "number" || !Number.isFinite(m.value)) errs.push(`${where}: ${String(status)} needs a finite numeric value`);
  if (typeof m.unit !== "string" || m.unit === "") errs.push(`${where}: ${String(status)} needs a unit`);
  if (status === "estimated" && (typeof m.method !== "string" || m.method === "")) errs.push(`${where}: estimated needs a method`);
  if ("reason" in m) errs.push(`${where}: only unavailable carries a reason`);
  if ("flags" in m) {
    const f = m.flags;
    if (!Array.isArray(f) || f.some((x) => typeof x !== "string" || !FLAGS.includes(x))) errs.push(`${where}: unknown flag(s) ${JSON.stringify(f)}`);
  }
  return errs;
}

/** Validates every metric object inside `data` (shape only). */
export function validateMetricShapes(data: Json, path = ""): string[] {
  if (Array.isArray(data)) return data.flatMap((e) => validateMetricShapes(e, `${path}[]`));
  if (!isRecord(data)) return [];
  if (typeof data.status === "string" && METRIC_STATUSES.includes(data.status)) return validateMetric(data, path);
  return Object.entries(data).flatMap(([k, c]) => validateMetricShapes(c, path ? `${path}.${k}` : k));
}

/**
 * Compares a payload with its field catalogue: every field returned must be
 * documented, a present metric's unit must match the documented unit, and (when
 * `requireAll`) every non-optional documented field must appear.
 */
export function validateAgainstDoc(
  name: string,
  docs: Record<string, FieldDoc>,
  samples: readonly Json[],
  opts: { requireAll: boolean },
): string[] {
  const errs: string[] = [];
  const seen = samples.flatMap((s) => walkFields(s));
  for (const s of seen) {
    const d = docs[s.path];
    if (d === undefined) { errs.push(`${name}: field "${s.path}" is returned but not documented`); continue; }
    if (s.unit !== null && d.unit !== s.unit) errs.push(`${name}: "${s.path}" documents unit ${String(d.unit)} but data says ${s.unit}`);
    if (d.kind === "metric" && !s.isMetric) errs.push(`${name}: "${s.path}" is documented as a metric but is not a metric object`);
    if (!s.isMetric && d.kind !== "metric") {
      const t = typeof s.value;
      const okType =
        d.kind === "number" ? t === "number" || s.value === null :
        d.kind === "boolean" ? t === "boolean" :
        d.kind === "string" || d.kind === "date" || d.kind === "instant" || d.kind === "enum" ? t === "string" || s.value === null :
        true;
      if (!okType) errs.push(`${name}: "${s.path}" is documented as ${d.kind} but holds a ${t}`);
      if (d.kind === "enum" && d.values && typeof s.value === "string" && !d.values.includes(s.value)) {
        errs.push(`${name}: "${s.path}" returned "${s.value}", which is not among the documented values ${d.values.join("|")}`);
      }
    }
  }
  if (opts.requireAll) {
    const paths = new Set(seen.map((s) => s.path));
    for (const [p, d] of Object.entries(docs)) {
      if (d.optional || d.kind === "object" || d.kind === "array") continue;
      if (!paths.has(p)) errs.push(`${name}: documented field "${p}" never appears`);
    }
  }
  return errs;
}

/** The envelope: success {apiVersion, generatedAt, timezone, data} or failure {apiVersion, error}. */
export function validateEnvelope(json: Json): { errors: string[]; data: Json | null; errorCode: string | null } {
  const errors: string[] = [];
  if (!isRecord(json)) return { errors: ["response is not a JSON object"], data: null, errorCode: null };
  if (json.apiVersion !== "1") errors.push(`apiVersion must be "1", got ${JSON.stringify(json.apiVersion)}`);
  if ("error" in json) {
    const e = json.error;
    if (!isRecord(e) || typeof e.code !== "string" || !ERROR_CODES.includes(e.code) || typeof e.message !== "string") {
      errors.push("error must be {code (known), message}");
      return { errors, data: null, errorCode: null };
    }
    if ("data" in json) errors.push("a failure must not carry data");
    return { errors, data: null, errorCode: e.code };
  }
  if (typeof json.generatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(json.generatedAt)) {
    errors.push(`generatedAt must be an ISO 8601 instant with an explicit offset, got ${JSON.stringify(json.generatedAt)}`);
  }
  if (typeof json.timezone !== "string" || json.timezone === "") errors.push("timezone must be a non-empty string");
  if (!("data" in json)) { errors.push("success must carry data"); return { errors, data: null, errorCode: null }; }
  return { errors, data: json.data, errorCode: null };
}

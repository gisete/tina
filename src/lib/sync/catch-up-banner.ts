// Client-loop state machine and banner view for the catch-up sync. Pure: step
// results in, next action and display model out. The component only renders it.

import { formatDateMMDD } from "@/lib/format";
import type { SyncStepResult } from "@/lib/sync/step-types";

/** A plain recent-window sync that finishes inside this stays invisible. */
export const SHOW_AFTER_MS = 2_000;
/** How often to re-ask while another sync holds the lock. */
export const BUSY_POLL_MS = 3_000;
/** Give up waiting on a busy lock after this long. */
export const BUSY_GIVE_UP_MS = 60_000;

/** Network/transport failure raised by the client (not a server result). */
export interface NetworkFailure {
  kind: "network_error";
  message: string;
}

export type LoopPhase = "syncing" | "busy" | "auth_required" | "error" | "done";

export interface LoopState {
  phase: LoopPhase;
  startedAtMs: number;
  /** First moment the lock was seen busy in the current busy streak. */
  busySinceMs: number | null;
  /** Largest gap-day total seen; echoed back to the server as previousTotal. */
  total: number;
  daysDone: number;
  /** Start of the first gap chunk and end of the latest one (gap progress range). */
  gapFrom: string | null;
  gapThrough: string | null;
  /** True once a unit ran here, or another sync held the lock meanwhile: a refresh at idle is worth it. */
  maybeChanged: boolean;
  message: string | null;
}

export type LoopAction = "call" | "wait" | "refresh" | "stop";

export interface LoopStep {
  state: LoopState;
  action: LoopAction;
  delayMs: number;
}

const STEP_KINDS: ReadonlySet<string> = new Set(["idle", "running", "busy", "auth_required", "error"]);

/** Validates a decoded response body; anything unexpected becomes a network failure. */
export function parseStepResult(body: unknown, status: number): SyncStepResult | NetworkFailure {
  if (typeof body === "object" && body !== null) {
    const kind = (body as { kind?: unknown }).kind;
    if (typeof kind === "string" && STEP_KINDS.has(kind)) return body as SyncStepResult;
  }
  return { kind: "network_error", message: `Sync failed (HTTP ${status}).` };
}

export function initialLoopState(nowMs: number): LoopState {
  return {
    phase: "syncing",
    startedAtMs: nowMs,
    busySinceMs: null,
    total: 0,
    daysDone: 0,
    gapFrom: null,
    gapThrough: null,
    maybeChanged: false,
    message: null,
  };
}

/** Folds one step result into the loop state and decides what the loop does next. */
export function applyResult(
  state: LoopState,
  result: SyncStepResult | NetworkFailure,
  nowMs: number,
): LoopStep {
  switch (result.kind) {
    case "running":
      return {
        state: {
          ...state,
          phase: "syncing",
          busySinceMs: null,
          maybeChanged: true,
          total: Math.max(state.total, result.daysTotal),
          daysDone: result.daysDone,
          gapFrom: result.unit === "gap" ? (state.gapFrom ?? result.from) : state.gapFrom,
          gapThrough: result.unit === "gap" ? result.to : state.gapThrough,
        },
        action: "call",
        delayMs: 0,
      };
    case "idle":
      return {
        state: { ...state, phase: "done", busySinceMs: null },
        action: state.maybeChanged ? "refresh" : "stop",
        delayMs: 0,
      };
    case "busy": {
      const since = state.busySinceMs ?? nowMs;
      if (nowMs - since >= BUSY_GIVE_UP_MS) {
        return {
          state: { ...state, phase: "error", busySinceMs: since, message: "Another sync is still running. Try again in a moment." },
          action: "stop",
          delayMs: 0,
        };
      }
      return {
        state: { ...state, phase: "busy", busySinceMs: since, maybeChanged: true },
        action: "wait",
        delayMs: BUSY_POLL_MS,
      };
    }
    case "auth_required":
      return { state: { ...state, phase: "auth_required" }, action: "stop", delayMs: 0 };
    case "error":
    case "network_error":
      return { state: { ...state, phase: "error", message: result.message }, action: "stop", delayMs: 0 };
  }
}

export type BannerView =
  | { kind: "hidden" }
  | { kind: "inline"; label: string }
  | { kind: "catching_up"; text: string; percent: number }
  | { kind: "auth_required"; text: string; actionLabel: string }
  | { kind: "error"; text: string; actionLabel: string };

export function bannerView(state: LoopState, nowMs: number): BannerView {
  switch (state.phase) {
    case "done":
      return { kind: "hidden" };
    case "auth_required":
      return {
        kind: "auth_required",
        text: "Google sign-in expired, so Tina can't fetch new data.",
        actionLabel: "Reconnect Google",
      };
    case "error":
      return { kind: "error", text: state.message ?? "Sync failed.", actionLabel: "Retry" };
    case "busy":
    case "syncing": {
      if (state.total > 0) {
        const range =
          state.gapFrom !== null && state.gapThrough !== null
            ? `${formatDateMMDD(state.gapFrom)} → ${formatDateMMDD(state.gapThrough)}, `
            : "";
        return {
          kind: "catching_up",
          text: `Catching up: ${range}${state.daysDone} of ${state.total} days`,
          percent: Math.min(100, Math.round((state.daysDone / state.total) * 100)),
        };
      }
      return nowMs - state.startedAtMs >= SHOW_AFTER_MS
        ? { kind: "inline", label: "Syncing…" }
        : { kind: "hidden" };
    }
  }
}

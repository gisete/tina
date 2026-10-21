// Wire contract of POST /api/sync/step. Plain JSON-safe types, shared by the
// route and the client loop.

export type SyncStepResult =
  | { kind: "idle" }
  | {
      kind: "running";
      /** The unit this call just synced. */
      unit: "recent" | "gap";
      from: string;
      to: string;
      daysDone: number;
      daysTotal: number;
    }
  | { kind: "busy" }
  | { kind: "auth_required" }
  | { kind: "error"; message: string };

export interface SyncStepRequest {
  /** Run the recent window regardless of staleness (manual Sync). */
  force?: boolean;
  /** Largest daysTotal seen so far, echoed back so progress stays stable. */
  previousTotal?: number;
}

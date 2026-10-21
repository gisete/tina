"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { reconnectGoogle } from "@/app/actions/reconnect";
import {
  applyResult,
  bannerView,
  initialLoopState,
  parseStepResult,
  type LoopState,
  type NetworkFailure,
} from "@/lib/sync/catch-up-banner";
import type { SyncStepRequest, SyncStepResult } from "@/lib/sync/step-types";

async function callStep(req: SyncStepRequest): Promise<SyncStepResult | NetworkFailure> {
  try {
    const res = await fetch("/api/sync/step", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    // 401 body is already { kind: "auth_required" }.
    return parseStepResult(await res.json().catch(() => null), res.status);
  } catch (e) {
    return { kind: "network_error", message: e instanceof Error ? e.message : "Network error" };
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Layout-level catch-up trigger. On mount it asks the step endpoint for one
 * unit of work at a time until it reports idle, then refreshes the route once.
 * Staleness and the gap plan live on the server; this only loops and renders.
 */
export default function CatchUpSync() {
  const router = useRouter();
  const [state, setState] = useState<LoopState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const started = useRef(false);
  const cancelled = useRef(false);

  const run = useCallback(async () => {
    let s = initialLoopState(Date.now());
    setState(s);
    while (!cancelled.current) {
      const result = await callStep({ previousTotal: s.total });
      if (cancelled.current) return;
      const step = applyResult(s, result, Date.now());
      s = step.state;
      setState(s);
      if (step.action === "refresh") router.refresh();
      if (step.action === "refresh" || step.action === "stop") return;
      if (step.action === "wait") await sleep(step.delayMs);
    }
  }, [router]);

  useEffect(() => {
    cancelled.current = false;
    // Strict Mode re-runs effects; the ref keeps a single loop alive.
    if (!started.current) {
      started.current = true;
      void run();
    }
    return () => {
      cancelled.current = true;
    };
  }, [run]);

  // Tick so the "show after 2s" rule can flip without a state change.
  useEffect(() => {
    if (!state || state.phase === "done" || state.phase === "error" || state.phase === "auth_required") return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [state]);

  if (!state) return null;
  const view = bannerView(state, now);

  if (view.kind === "hidden") return null;

  if (view.kind === "inline") {
    return (
      <div role="status" className="flex justify-end px-4 pt-2 animate-in fade-in duration-300">
        <span className="inline-flex items-center gap-1.5 text-xs text-on-surface-variant">
          <span className="inline-block w-2.5 h-2.5 border-2 border-on-surface-variant border-t-transparent rounded-full animate-spin" />
          {view.label}
        </span>
      </div>
    );
  }

  if (view.kind === "catching_up") {
    return (
      <div
        role="status"
        className="border-b border-outline-variant bg-surface-container px-4 py-3 animate-in fade-in slide-in-from-top-2 duration-300"
      >
        <p className="text-sm font-medium text-on-surface">{view.text}</p>
        <div
          className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-container-high"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={view.percent}
        >
          <div className="h-full rounded-full bg-on-surface transition-all duration-500" style={{ width: `${view.percent}%` }} />
        </div>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant bg-surface-container px-4 py-3 animate-in fade-in slide-in-from-top-2 duration-300"
    >
      <p className="text-sm text-on-surface">{view.text}</p>
      {view.kind === "auth_required" ? (
        <form action={reconnectGoogle}>
          <button
            type="submit"
            className="rounded-full bg-on-surface px-3 py-1.5 text-xs font-semibold text-surface hover:opacity-90 transition-opacity"
          >
            {view.actionLabel}
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => {
            // Manual retry only: start a fresh single loop.
            cancelled.current = false;
            void run();
          }}
          className="rounded-full border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-xs font-semibold text-on-surface hover:bg-surface-container transition-colors"
        >
          {view.actionLabel}
        </button>
      )}
    </div>
  );
}

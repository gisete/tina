"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncFromGoogle } from "@/app/actions/sync";

function formatRelativeTime(isoStr: string): string {
  const elapsed = Date.now() - new Date(isoStr).getTime();
  if (elapsed < 60_000)      return "synced just now";
  if (elapsed < 3_600_000)   return `synced ${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000)  return `synced ${Math.floor(elapsed / 3_600_000)}h ago`;
  return `synced ${Math.floor(elapsed / 86_400_000)}d ago`;
}

interface Props {
  lastSyncedAt: string | null;
}

export default function SyncButton({ lastSyncedAt }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleSync = () => {
    startTransition(async () => {
      await syncFromGoogle();
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-2.5">
      {lastSyncedAt && !isPending && (
        <span className="text-xs text-on-surface-variant tabular-nums">
          {formatRelativeTime(lastSyncedAt)}
        </span>
      )}
      <button
        onClick={handleSync}
        disabled={isPending}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full border border-outline-variant bg-white hover:bg-surface-container transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {isPending ? (
          <>
            <span className="inline-block w-3 h-3 border-2 border-on-surface-variant border-t-transparent rounded-full animate-spin" />
            <span>Syncing…</span>
          </>
        ) : (
          <>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-on-surface-variant">
              <path
                d="M10 6A4 4 0 1 1 6 2"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <path
                d="M6 2 L8.5 4.5 L6 4.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Sync</span>
          </>
        )}
      </button>
    </div>
  );
}

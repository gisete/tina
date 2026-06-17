"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncFromGoogle } from "@/app/actions/sync";

interface Props {
  shouldSync: boolean;
}

/**
 * Invisible trigger component: when shouldSync is true, fires syncFromGoogle
 * on first mount (useEffect, post-render) then refreshes the current route.
 * Mirrors the SyncButton mechanism exactly — startTransition → syncFromGoogle
 * → router.refresh() — so revalidatePath inside syncFromGoogle is legal.
 *
 * Renders nothing when idle. Shows a subtle "Updating…" indicator while the
 * background sync + route refresh is in flight.
 */
export default function AutoSync({ shouldSync }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const fired = useRef(false);

  useEffect(() => {
    if (!shouldSync || fired.current) return;
    fired.current = true;

    startTransition(async () => {
      try {
        await syncFromGoogle();
        router.refresh();
      } catch {
        // Non-fatal — leave cached data shown, same as the old in-render behavior.
      }
    });
  }, [shouldSync, router]);

  if (!isPending) return null;

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-on-surface-variant">
      <span className="inline-block w-2.5 h-2.5 border-2 border-on-surface-variant border-t-transparent rounded-full animate-spin" />
      Updating…
    </span>
  );
}

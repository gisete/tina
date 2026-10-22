import type { ReactNode } from "react";

/** Shared frame for every dashboard page: one width, one gutter, one vertical rhythm. */
export function PageShell({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl space-y-7 px-4 py-10 pb-24 md:px-12">{children}</div>;
}

/** The page title: 44px, weight 400, optional muted meta text beside it. */
export function PageTitle({ children, meta, className = "" }: { children: ReactNode; meta?: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-wrap items-baseline gap-x-3.5 gap-y-1.5 ${className}`}>
      <h1 className="font-display text-[44px] font-normal leading-none tracking-[-0.025em] text-on-surface">{children}</h1>
      {meta && <p className="text-lg text-on-surface-variant">{meta}</p>}
    </div>
  );
}

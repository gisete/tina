"use client";

import { useState, useId, type ReactNode } from "react";

interface ExpandableCardProps {
  title: string;
  /** Node rendered at the top-right of the title row. Omit for nothing. */
  headerRight?: ReactNode;
  /** Always-visible glance summary beneath the title. */
  overview: ReactNode;
  /** Detail content revealed when expanded. */
  children: ReactNode;
  defaultExpanded?: boolean;
  /** Optional label prepended to the chevron. Omit for chevron-only toggle. */
  expandLabel?: string;
  /** Extra classes appended to the outer card div (e.g. hover shadows). */
  className?: string;
}

export default function ExpandableCard({
  title,
  headerRight,
  overview,
  children,
  defaultExpanded = false,
  expandLabel,
  className,
}: ExpandableCardProps) {
  const [open, setOpen] = useState(defaultExpanded);
  const detailId = useId();

  return (
    <div
      className={`bg-white border border-outline-variant rounded-[1.5rem] p-card-padding${className ? ` ${className}` : ""}`}
    >
      <div className="flex items-start justify-between mb-4">
        <h2 className="font-display text-xl font-bold text-on-surface tracking-tight">
          {title}
        </h2>
        {headerRight}
      </div>

      {/* Overview — always visible */}
      <div>{overview}</div>

      {/* Toggle — matches Sleep Score card expand button */}
      <div className="mt-4">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={detailId}
          className="text-xs font-semibold text-on-surface-variant hover:text-on-surface transition-colors flex items-center gap-1"
        >
          {expandLabel != null && <span>{expandLabel}</span>}
          <span>{open ? "▴" : "▾"}</span>
        </button>
      </div>

      {/* Detail — divider matches Sleep Score card section separator */}
      {open && (
        <div
          id={detailId}
          className="mt-4 pt-4 border-t border-outline-variant/50 animate-in fade-in duration-200"
        >
          {children}
        </div>
      )}
    </div>
  );
}

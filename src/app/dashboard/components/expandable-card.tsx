"use client";

import { useState, useId, type ReactNode } from "react";
import { EYEBROW } from "./stat-card";

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
      className={`rounded-card border border-hairline bg-white p-8${className ? ` ${className}` : ""}`}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 className={`${EYEBROW} text-on-surface-variant`}>{title}</h2>
        {headerRight}
      </div>

      {/* Overview — always visible */}
      <div>{overview}</div>

      {/* Toggle */}
      <div className="mt-4">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={detailId}
          className="text-sm font-medium text-on-surface-variant hover:text-on-surface transition-colors flex items-center gap-1"
        >
          {expandLabel != null && <span>{expandLabel}</span>}
          <span>{open ? "▴" : "▾"}</span>
        </button>
      </div>

      {/* Detail */}
      {open && (
        <div
          id={detailId}
          className="mt-4 pt-4 border-t border-hairline animate-in fade-in duration-200"
        >
          {children}
        </div>
      )}
    </div>
  );
}

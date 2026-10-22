"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type IconName = "today" | "overview" | "sleep" | "heart" | "plan" | "activity";

// Inline line icons (24px grid, stroke 1.6). No icon library is installed.
const ICONS: Record<IconName, ReactNode> = {
  today: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  overview: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </>
  ),
  sleep: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" />,
  plan: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </>
  ),
  activity: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />,
};

function Icon({ name }: { name: IconName }) {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      {ICONS[name]}
    </svg>
  );
}

const ITEMS: ReadonlyArray<{ href: string; label: string; icon: IconName; exact?: boolean }> = [
  { href: "/dashboard/today", label: "Today", icon: "today" },
  { href: "/dashboard", label: "Dashboard Overview", icon: "overview", exact: true },
  { href: "/dashboard/sleep", label: "Sleep Intelligence", icon: "sleep" },
  { href: "/dashboard/heart", label: "Heart Health", icon: "heart" },
  { href: "/dashboard/plan", label: "Plan", icon: "plan" },
];

const ROW = "flex min-h-11 items-center gap-3 rounded-[14px] px-3.5 text-base";

export default function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="flex flex-1 flex-col gap-1">
      {ITEMS.map((item) => {
        const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`${ROW} transition-colors ${
              active ? "bg-nav-active font-medium text-nav-ink" : "text-nav-text hover:bg-nav-active/60"
            }`}
          >
            <Icon name={item.icon} />
            {item.label}
          </Link>
        );
      })}

      <div className={`${ROW} select-none text-on-surface-variant`}>
        <Icon name="activity" />
        <span className="leading-[1.15]">Exercise &amp; Endurance</span>
        <span className="ml-auto text-[10px] font-medium tracking-[0.1em]">SOON</span>
      </div>
    </nav>
  );
}

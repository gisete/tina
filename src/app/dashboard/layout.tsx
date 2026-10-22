import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import CatchUpSync from "./components/catch-up-sync";
import SidebarNav from "./components/sidebar-nav";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");

  return (
    <div className="font-sans bg-surface text-on-surface antialiased flex h-screen w-full overflow-hidden">

      {/* Sidebar */}
      <aside className="z-40 hidden h-screen w-sidebar-width shrink-0 flex-col gap-7 border-r border-sidebar-border bg-surface px-5 py-8 md:flex">

        {/* Brand */}
        <div className="px-3.5">
          <div className="font-display text-[30px] font-medium leading-none tracking-[-0.02em] text-on-surface">Tina</div>
          <div className="mt-2 text-[11px] font-medium uppercase tracking-[0.1em] text-on-surface-variant">Health analytics</div>
        </div>

        <SidebarNav />

        {/* User Footer */}
        <div className="space-y-3 border-t border-sidebar-border pt-4">
          <div className="px-3.5">
            <p className="text-xs text-on-surface-variant">Signed in as</p>
            <p className="truncate text-sm font-medium text-on-surface">{session.user.name}</p>
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button className="flex min-h-11 w-full items-center justify-center rounded-full border border-sidebar-border px-4 text-[15px] font-medium text-on-surface-variant transition-colors hover:bg-nav-active/60 hover:text-on-surface">
              Log Out
            </button>
          </form>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 h-screen overflow-y-auto bg-background">
        {/* Mobile nav — the sidebar is hidden below md */}
        <nav className="md:hidden sticky top-0 z-30 flex gap-1 overflow-x-auto border-b border-outline-variant bg-surface px-3 py-2">
          {[
            { href: "/dashboard/today", label: "Today" },
            { href: "/dashboard/plan", label: "Plan" },
            { href: "/dashboard/sleep", label: "Sleep" },
            { href: "/dashboard/heart", label: "Heart" },
            { href: "/dashboard", label: "Overview" },
          ].map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="shrink-0 rounded-xl px-3 py-1.5 text-sm font-medium text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <CatchUpSync />
        {children}
      </main>

    </div>
  );
}

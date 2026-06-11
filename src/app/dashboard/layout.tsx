import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

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
      <aside className="hidden md:flex flex-col h-screen w-sidebar-width shrink-0 border-r border-outline-variant bg-surface py-8 z-40">

        {/* Brand */}
        <div className="px-6 mb-8">
          <div className="font-display text-2xl font-bold tracking-tight text-on-surface">Tina</div>
          <div className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mt-0.5">Health Analytics</div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 space-y-1">
          <Link
            href="/dashboard"
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors"
          >
            <span>🏠</span>
            <span>Dashboard Overview</span>
          </Link>

          <Link
            href="/dashboard/sleep"
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors"
          >
            <span>🌙</span>
            <span>Sleep Intelligence</span>
          </Link>

          <Link
            href="/dashboard/heart"
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors"
          >
            <span>❤️</span>
            <span>Heart Health</span>
          </Link>

          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-neutral-400 pointer-events-none select-none">
            <span>🏃‍♂️</span>
            <span>Exercise & Endurance</span>
            <span className="ml-auto text-xs font-semibold uppercase tracking-wider">Soon</span>
          </div>
        </nav>

        {/* User Footer */}
        <div className="px-3 pt-4 border-t border-outline-variant space-y-3">
          <div className="px-3 py-2">
            <p className="text-xs text-on-surface-variant">Signed in as</p>
            <p className="text-sm font-semibold text-on-surface truncate">{session.user.name}</p>
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button className="w-full flex items-center justify-center rounded-xl border border-outline-variant px-4 py-2 text-sm font-semibold text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors">
              Log Out
            </button>
          </form>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 h-screen overflow-y-auto bg-background">
        {children}
      </main>

    </div>
  );
}

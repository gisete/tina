"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { addDays, localToday } from "@/lib/dates";

export default function DateNavigator() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeDate = searchParams.get("date") || localToday();

  const mergeDate = (newDate: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("date", newDate);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="flex items-center justify-between border rounded-full px-3 py-1.5 w-fit shadow-sm bg-white border-zinc-200">
      <button
        onClick={() => mergeDate(addDays(activeDate, -1))}
        className="p-1 text-zinc-600 hover:bg-zinc-100 rounded-full transition-colors flex items-center justify-center text-sm font-bold"
        aria-label="Previous day"
      >
        &larr;
      </button>

      <div className="px-4 flex items-center cursor-pointer">
        <input
          type="date"
          value={activeDate}
          max={localToday()}
          onChange={(e) => mergeDate(e.target.value)}
          className="bg-transparent border-none outline-none text-center cursor-pointer text-sm font-semibold text-zinc-900 tracking-tight [color-scheme:light]"
        />
      </div>

      <button
        onClick={() => mergeDate(addDays(activeDate, 1))}
        disabled={activeDate === localToday()}
        className="p-1 text-zinc-600 hover:bg-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent rounded-full transition-colors flex items-center justify-center text-sm font-bold"
        aria-label="Next day"
      >
        &rarr;
      </button>
    </div>
  );
}

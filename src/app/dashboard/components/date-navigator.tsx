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

  const BTN =
    "flex h-11 w-11 items-center justify-center rounded-full text-lg text-on-surface hover:bg-surface-container transition-colors disabled:text-on-surface-variant disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <div className="inline-flex w-fit items-center gap-1 rounded-full border border-hairline bg-white p-1">
      <button onClick={() => mergeDate(addDays(activeDate, -1))} className={BTN} aria-label="Previous day">
        &larr;
      </button>

      <div className="flex items-center px-2.5">
        <input
          type="date"
          value={activeDate}
          max={localToday()}
          onChange={(e) => mergeDate(e.target.value)}
          className="cursor-pointer border-none bg-transparent text-center text-[15px] font-medium text-on-surface outline-none [color-scheme:light]"
        />
      </div>

      <button
        onClick={() => mergeDate(addDays(activeDate, 1))}
        disabled={activeDate === localToday()}
        className={BTN}
        aria-label="Next day"
      >
        &rarr;
      </button>
    </div>
  );
}

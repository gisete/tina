import { parseLocalDate } from "@/lib/dates";
import type { IsoWeekday } from "./types";

/**
 * Local "YYYY-MM-DD" → ISO weekday (1 = Monday … 7 = Sunday). Goes through
 * parseLocalDate (local midnight), so the result never shifts with UTC.
 */
export function isoWeekdayOf(date: string): IsoWeekday {
  const day = parseLocalDate(date).getDay(); // 0 = Sunday … 6 = Saturday
  return (day === 0 ? 7 : day) as IsoWeekday;
}

/**
 * The week at a glance, on the slab: seven days, what was done, what is
 * planned, and which one is today.
 *
 * Each state has its own shape as well as its own colour — a filled volt
 * disc with a tick for a session done, a ring for one planned, a plain
 * number otherwise — and today is underlined. The whole thing is also
 * described in words for a screen reader.
 */

import { Check } from "lucide-react";

import type { DayMark } from "@/lib/training/calendar";
import { cn } from "@/lib/utils";

const DAYS = ["M", "T", "W", "T", "F", "S", "S"];
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function WeekStrip({ week }: { week: DayMark[] }) {
  return (
    <ol className="grid grid-cols-7 gap-1" aria-label="This week">
      {week.map((day, i) => {
        const done = day.done.length > 0;
        const planned = !done && day.planned.length > 0;
        return (
          <li key={day.date} className="flex flex-col items-center gap-1.5">
            <span className="eyebrow" aria-hidden>{DAYS[i]}</span>
            <span
              className={cn(
                "flex size-9 items-center justify-center rounded-full text-sm font-semibold tabular-nums",
                done
                  ? "bg-volt text-volt-foreground"
                  : planned
                    ? "border-volt border-2 border-dashed"
                    : "bg-white/8",
              )}
            >
              {done ? <Check className="size-4" aria-hidden strokeWidth={3} /> : <span aria-hidden>{day.day}</span>}
              <span className="sr-only">
                {DAY_NAMES[i]} {day.day}
                {day.isToday ? ", today" : ""}:{" "}
                {done
                  ? `${day.done.map((s) => s.name).join(", ")} done`
                  : planned
                    ? `${day.planned.map((p) => p.name).join(", ")} planned`
                    : "nothing"}
              </span>
            </span>
            <span
              aria-hidden
              className={cn("h-0.5 w-5 rounded-full", day.isToday ? "bg-slab-foreground" : "")}
            />
          </li>
        );
      })}
    </ol>
  );
}

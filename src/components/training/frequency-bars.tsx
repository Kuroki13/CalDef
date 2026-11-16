/**
 * Sessions per week, as bars. Real counts only: a week with no session is
 * an empty slot with a zero under it, not a missing bar, and the scale
 * starts at zero so a week of two is visibly half a week of four.
 */

import type { WeekCount } from "@/lib/training/calendar";
import { formatLongDate } from "@/lib/dates";

export function FrequencyBars({ weeks }: { weeks: WeekCount[] }) {
  const max = Math.max(1, ...weeks.map((w) => w.sessions));
  const total = weeks.reduce((n, w) => n + w.sessions, 0);

  return (
    <figure>
      <ol
        className="flex h-28 items-end gap-2"
        aria-label={`Sessions per week over ${weeks.length} weeks, ${total} in total`}
      >
        {weeks.map((week, i) => (
          <li key={week.weekStart} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
            <span className="text-xs font-semibold tabular-nums" aria-hidden>
              {week.sessions}
            </span>
            <span
              className={
                i === weeks.length - 1
                  ? "bg-foreground w-full rounded-md"
                  : "bg-foreground/25 w-full rounded-md"
              }
              style={{ height: `${Math.max(week.sessions === 0 ? 2 : 8, (week.sessions / max) * 72)}%` }}
            />
            <span className="sr-only">
              Week of {formatLongDate(week.weekStart)}: {week.sessions}{" "}
              {week.sessions === 1 ? "session" : "sessions"}
            </span>
          </li>
        ))}
      </ol>
      <figcaption className="text-muted-foreground mt-2 flex justify-between text-xs">
        <span>{formatLongDate(weeks[0].weekStart)}</span>
        <span>This week</span>
      </figcaption>
    </figure>
  );
}

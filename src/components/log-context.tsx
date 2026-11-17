"use client";

/**
 * Where an entry is going: which meal, which day.
 *
 * Shown at the top of the adding tool and kept there until the entry is
 * saved, because the commonest logging mistake is not a wrong food but the
 * right food on the wrong meal or the wrong day. Both are chosen by the
 * "+" that opened the tool, and both can be changed here at any point.
 */

import { CalendarDays } from "lucide-react";

import { addDays, formatLongDate } from "@/lib/dates";
import type { MealType } from "@/lib/diary";
import { cn } from "@/lib/utils";

export function LogContext({
  meals,
  mealId,
  onMealChange,
  date,
  onDateChange,
  maxDate,
}: {
  meals: MealType[];
  mealId: number;
  onMealChange: (id: number) => void;
  date: string;
  onDateChange: (date: string) => void;
  /** Today, in the user's time zone: a day that has not happened is not logged. */
  maxDate: string;
}) {
  const dayWord =
    date === maxDate ? "Today" : date === addDays(maxDate, -1) ? "Yesterday" : null;

  return (
    <fieldset className="space-y-2.5">
      <legend className="eyebrow mb-2">Adding to</legend>
      <div role="radiogroup" aria-label="Meal" className="grid grid-cols-4 gap-1 rounded-xl bg-muted p-1">
        {meals.map((meal) => {
          const active = meal.id === mealId;
          return (
            <button
              key={meal.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onMealChange(meal.id)}
              className={cn(
                "min-h-11 truncate rounded-lg px-1 text-sm",
                active
                  ? "bg-foreground text-background font-semibold"
                  : "text-muted-foreground font-medium hover:text-foreground",
              )}
            >
              {meal.name}
            </button>
          );
        })}
      </div>
      <label className="relative flex min-h-11 items-center gap-3 rounded-xl border px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-(--focus)">
        <CalendarDays className="text-muted-foreground size-4 shrink-0" aria-hidden />
        <span className="flex-1 text-sm">
          <span className="font-semibold">{formatLongDate(date)}</span>
          {dayWord ? <span className="text-muted-foreground"> · {dayWord}</span> : null}
        </span>
        <span className="text-muted-foreground text-xs font-semibold">Change</span>
        {/* The native picker: the phone's own calendar, nothing to load. It
            covers the row, so a tap anywhere on it opens the calendar. */}
        <input
          type="date"
          aria-label="Date"
          value={date}
          max={maxDate}
          required
          onChange={(event) => {
            const next = event.target.value;
            if (next && next <= maxDate) onDateChange(next);
          }}
          onClick={(event) => {
            try {
              event.currentTarget.showPicker();
            } catch {
              // Older browsers open it on their own, or take typed input.
            }
          }}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
      </label>
    </fieldset>
  );
}

"use client";

/**
 * The day being looked at, and the way to another one: previous, next, any
 * date from the phone's own calendar, and "Today" when elsewhere. A day that
 * has not happened is not offered — the calendar stops at today.
 */

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Spinner } from "@/components/pending-button";
import { LinkPending } from "@/components/pending-nav";
import { addDays, formatLongDate } from "@/lib/dates";

const ROUND = "flex size-11 shrink-0 items-center justify-center rounded-full bg-white/10 hover:bg-white/20";

export function DayNav({ date, today }: { date: string; today: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const label =
    date === today ? "Today" : date === addDays(today, -1) ? "Yesterday" : null;

  return (
    <nav aria-label="Day" className="flex items-center gap-2">
      <Link href={`/diary?date=${addDays(date, -1)}`} className={ROUND} aria-label="Previous day">
        <LinkPending spinnerClassName="size-5">
          <ChevronLeft className="size-5" aria-hidden />
        </LinkPending>
      </Link>

      <label className="relative flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-full px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-(--focus) hover:bg-white/10">
        {pending ? <Spinner className="size-4" /> : <CalendarDays className="text-slab-muted size-4 shrink-0" aria-hidden />}
        <span className="display truncate text-2xl">{formatLongDate(date)}</span>
        {label ? <span className="text-slab-muted text-sm">{label}</span> : null}
        <input
          type="date"
          aria-label="Choose a day"
          value={date}
          max={today}
          onClick={(event) => {
            try {
              event.currentTarget.showPicker();
            } catch {
              // Opens on its own where showPicker is missing.
            }
          }}
          onChange={(event) => {
            const next = event.target.value;
            if (!next || next > today) return;
            startTransition(() => router.push(`/diary?date=${next}`));
          }}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
      </label>

      {date < today ? (
        <Link href={`/diary?date=${addDays(date, 1)}`} className={ROUND} aria-label="Next day">
          <LinkPending spinnerClassName="size-5">
            <ChevronRight className="size-5" aria-hidden />
          </LinkPending>
        </Link>
      ) : (
        <span aria-hidden className={`${ROUND} pointer-events-none bg-transparent opacity-25`}>
          <ChevronRight className="size-5" />
        </span>
      )}
    </nav>
  );
}

/** "Today", when another day is on screen: one tap home. */
export function BackToToday() {
  return (
    <Link
      href="/diary"
      className="flex min-h-11 items-center rounded-full bg-white/10 px-4 text-sm font-semibold hover:bg-white/20"
    >
      <LinkPending>Back to today</LinkPending>
    </Link>
  );
}

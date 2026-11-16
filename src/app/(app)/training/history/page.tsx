import { ArrowRight, Check, ChevronLeft, ChevronRight, History } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { todayInTimeZone } from "@/lib/dates";
import { getAccountSetup } from "@/lib/profile";
import {
  isMonth,
  monthGrid,
  monthLabel,
  shiftMonth,
} from "@/lib/training/calendar";
import {
  listCompletedSessions,
  listSchedule,
  listSessionStarts,
} from "@/lib/training/store";
import { dayOf, summaryLine } from "@/lib/training/view";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Training history · CalDef" };

const LIMIT = 200;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * What was done: as a calendar — which days, and what is planned — and as
 * a list, newest first.
 *
 * In the calendar a day's state is a shape, not only a colour: a filled
 * disc with a tick is a session done (and a link to it), a dashed ring is
 * one planned, and today is outlined.
 */
export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { profile } = await getAccountSetup();
  if (!profile) return null;

  const today = todayInTimeZone(profile.timezone);
  const requested = (await searchParams).month;
  const month = requested && isMonth(requested) ? requested : today.slice(0, 7);

  const gridStart = `${shiftMonth(month, -1)}-20`;
  const gridEnd = `${shiftMonth(month, 1)}-10`;
  const [sessions, starts, plans] = await Promise.all([
    listCompletedSessions(LIMIT),
    listSessionStarts(`${gridStart}T00:00:00Z`),
    listSchedule(gridStart, gridEnd),
  ]);

  const done = starts.map((s) => ({
    id: s.id,
    name: s.name,
    date: todayInTimeZone(profile.timezone, new Date(s.startedAt)),
  }));
  const grid = monthGrid(month, today, { done, planned: plans });
  const inMonth = done.filter((d) => d.date.startsWith(month)).length;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Training" title="History" />

      <div className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-8">
        <section aria-label="Calendar" className="bg-card rounded-2xl p-4 lg:col-span-5">
          <div className="flex items-center justify-between gap-2">
            <Button asChild variant="ghost" size="icon">
              <Link href={`/training/history?month=${shiftMonth(month, -1)}`} aria-label="Previous month">
                <ChevronLeft />
              </Link>
            </Button>
            <div className="text-center">
              <h2 className="display text-2xl">{monthLabel(month)}</h2>
              <p className="text-muted-foreground text-xs">
                {inMonth} {inMonth === 1 ? "session" : "sessions"}
              </p>
            </div>
            <Button asChild variant="ghost" size="icon">
              <Link href={`/training/history?month=${shiftMonth(month, 1)}`} aria-label="Next month">
                <ChevronRight />
              </Link>
            </Button>
          </div>

          <table className="mt-3 w-full table-fixed border-separate border-spacing-y-1 text-center">
            <thead>
              <tr>
                {WEEKDAYS.map((day) => (
                  <th key={day} scope="col" className="eyebrow pb-1 font-semibold">
                    <abbr title={day} className="no-underline">{day.slice(0, 1)}</abbr>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.map((week) => (
                <tr key={week[0].date}>
                  {week.map((day) => {
                    const isDone = day.done.length > 0;
                    const isPlanned = !isDone && day.planned.length > 0;
                    const cell = cn(
                      "mx-auto flex size-10 items-center justify-center rounded-full text-sm tabular-nums",
                      !day.inMonth && "opacity-35",
                      isDone && "bg-foreground text-volt font-bold",
                      isPlanned && "border-foreground border-2 border-dashed font-semibold",
                      day.isToday && !isDone && "ring-foreground ring-2 ring-offset-2",
                    );
                    const words = `${day.date}${day.isToday ? ", today" : ""}: ${
                      isDone
                        ? `${day.done.map((s) => s.name).join(", ")} done`
                        : isPlanned
                          ? `${day.planned.map((p) => p.name).join(", ")} planned`
                          : "no session"
                    }`;
                    return (
                      <td key={day.date} className="p-0">
                        {isDone ? (
                          <Link href={`/training/history/${day.done[0].id}`} className={cell} aria-label={words}>
                            <Check className="size-4" aria-hidden strokeWidth={3} />
                          </Link>
                        ) : (
                          <span className={cell}>
                            <span aria-hidden>{day.day}</span>
                            <span className="sr-only">{words}</span>
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <p className="text-muted-foreground mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="bg-foreground text-volt flex size-4 items-center justify-center rounded-full">
                <Check className="size-2.5" strokeWidth={4} />
              </span>
              Done
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="border-foreground size-4 rounded-full border-2 border-dashed" />
              Planned
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="ring-foreground size-3 rounded-full ring-2 ring-offset-1" />
              Today
            </span>
          </p>
        </section>

        <section aria-label="All sessions" className="mt-6 lg:col-span-7 lg:mt-0">
          {sessions.length === 0 ? (
            <EmptyState
              icon={History}
              title="Nothing logged yet"
              action={
                <Button asChild variant="volt" className="rounded-full px-5">
                  <Link href="/training">Go to training</Link>
                </Button>
              }
            >
              Sessions you finish appear here, with every set you did.
            </EmptyState>
          ) : (
            <>
              <p className="eyebrow px-1 pb-2">
                {sessions.length}
                {sessions.length === LIMIT ? "+" : ""} {sessions.length === 1 ? "session" : "sessions"}, newest first
              </p>
              <ul className="bg-card divide-y rounded-2xl px-4">
                {sessions.map((session) => (
                  <li key={session.id}>
                    <Link href={`/training/history/${session.id}`} className="flex min-h-16 items-center gap-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{session.name}</span>
                        <span className="text-muted-foreground block truncate text-sm">
                          {dayOf(session.startedAt, profile.timezone)} ·{" "}
                          {summaryLine(session, profile.unit_system)}
                        </span>
                      </span>
                      <ArrowRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

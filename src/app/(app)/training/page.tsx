import { ArrowRight, Dumbbell, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState, SectionTitle, Slab } from "@/components/page-header";
import { PlanRow } from "@/components/training/plan-row";
import { StartWorkoutButton } from "@/components/training/start-button";
import { WeekStrip } from "@/components/training/week-strip";
import { WorkoutRow } from "@/components/training/workout-row";
import { Button } from "@/components/ui/button";
import { addDays, formatLongDate, startOfIsoWeek, todayInTimeZone } from "@/lib/dates";
import { getAccountSetup } from "@/lib/profile";
import { weekOf } from "@/lib/training/calendar";
import {
  getActiveSessionSummary,
  listCompletedSessions,
  listPrograms,
  listSchedule,
  listSessionStarts,
  listTemplates,
} from "@/lib/training/store";
import type { WorkoutTemplate } from "@/lib/training/types";
import { dayOf, summaryLine } from "@/lib/training/view";

export const metadata: Metadata = { title: "Training · CalDef" };

/**
 * The training home. In order of urgency:
 *
 *   the week         what was done, what is planned (the slab)
 *   what is planned  today's workout to start, the next ones to move
 *   your workouts    by programme; Start on the row, the rest in a menu
 *   what you did     the last few sessions
 *
 * A session in progress is not repeated here: the bar at the bottom of
 * every screen is its way back in, and while it runs no other can start.
 */
export default async function TrainingPage() {
  const { profile } = await getAccountSetup();
  if (!profile) return null;

  const today = todayInTimeZone(profile.timezone);
  const monday = startOfIsoWeek(today);

  const [active, templates, programs, recent, plans, starts] = await Promise.all([
    getActiveSessionSummary(),
    listTemplates(),
    listPrograms(),
    listCompletedSessions(3),
    listSchedule(monday, addDays(today, 28)),
    // A day either side, because a UTC day is not the user's day.
    listSessionStarts(new Date(Date.parse(`${monday}T00:00:00Z`) - 86_400_000).toISOString()),
  ]);

  const done = starts.map((s) => ({
    id: s.id,
    name: s.name,
    date: todayInTimeZone(profile.timezone, new Date(s.startedAt)),
  }));
  const week = weekOf(today, today, { done, planned: plans });
  const sessionsThisWeek = week.reduce((n, day) => n + day.done.length, 0);
  // A plan carried out is no longer a plan. Matched by day and name: the
  // session keeps the workout's name from when it started.
  const upcoming = plans.filter(
    (plan) => plan.date >= today && !done.some((d) => d.date === plan.date && d.name === plan.name),
  );

  const when = (date: string) =>
    date === today ? "Today" : date === addDays(today, 1) ? "Tomorrow" : formatLongDate(date);

  const grouped: { title: string | null; items: WorkoutTemplate[] }[] = [
    ...programs.map((program) => ({
      title: program.name,
      items: templates.filter((t) => t.programId === program.id),
    })),
    { title: null, items: templates.filter((t) => t.programId === null || !programs.some((p) => p.id === t.programId)) },
  ].filter((group) => group.items.length > 0);

  return (
    <div className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-8">
      <div className="lg:sticky lg:top-0 lg:col-span-5">
        <Slab>
          <h1 className="display text-3xl">Training</h1>
          <p className="mt-4 flex items-end gap-3">
            <span className="figure text-7xl leading-[0.8]">{sessionsThisWeek}</span>
            <span className="text-slab-muted pb-1 text-sm leading-tight">
              {sessionsThisWeek === 1 ? "session" : "sessions"}
              <br />
              this week
            </span>
          </p>
          <div className="border-slab-line mt-6 border-t pt-5">
            <WeekStrip week={week} />
          </div>
        </Slab>

        <div className="mt-4 grid grid-cols-2 gap-3">
          {active ? (
            <p className="text-muted-foreground col-span-2 px-1 text-sm">
              Finish or discard “{active.name}” to start another session.
            </p>
          ) : (
            <StartWorkoutButton
              sessionName="Free session"
              // One volt action per screen: a workout planned today, or the
              // invitation to build the first one, takes it instead.
              variant={upcoming[0]?.date === today || templates.length === 0 ? "outline" : "volt"}
              size="lg"
              className="w-full rounded-2xl"
            >
              Free session
            </StartWorkoutButton>
          )}
          <Button asChild variant="outline" size="lg" className={active ? "col-span-2 rounded-2xl" : "rounded-2xl"}>
            <Link href="/training/templates/new">
              <Plus aria-hidden /> Create workout
            </Link>
          </Button>
        </div>
      </div>

      <div className="mt-6 space-y-7 lg:col-span-7 lg:mt-10">
        {upcoming.length > 0 ? (
          <section aria-labelledby="planned-heading">
            <SectionTitle id="planned-heading">Planned</SectionTitle>
            <ul className="bg-card mt-2 divide-y rounded-2xl px-4">
              {upcoming.slice(0, 5).map((plan) => (
                <PlanRow
                  key={plan.id}
                  plan={plan}
                  when={when(plan.date)}
                  canStart={!active && plan.date === today}
                />
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="workouts-heading">
          <SectionTitle id="workouts-heading">Workouts</SectionTitle>
          {templates.length === 0 ? (
            <div className="mt-2">
              <EmptyState
                icon={Dumbbell}
                title="Build your first workout"
                action={
                  <Button asChild variant="volt" className="rounded-full px-5">
                    <Link href="/training/templates/new">Create “Push A”</Link>
                  </Button>
                }
              >
                Pick exercises, set sets and rest, and start it whenever you
                train. Or tap Free session and add exercises as you go.
              </EmptyState>
            </div>
          ) : (
            <div className="mt-2 space-y-4">
              {grouped.map((group) => (
                <div key={group.title ?? "none"}>
                  {group.title ? <p className="eyebrow px-1 pb-1">{group.title}</p> : null}
                  <ul className="bg-card divide-y rounded-2xl px-4">
                    {group.items.map((template) => (
                      <WorkoutRow
                        key={template.id}
                        template={template}
                        programs={programs}
                        today={today}
                        canStart={!active}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="history-heading">
          <SectionTitle
            id="history-heading"
            action={
              <Button asChild variant="ghost">
                <Link href="/training/history">
                  All & calendar <ArrowRight aria-hidden />
                </Link>
              </Button>
            }
          >
            History
          </SectionTitle>
          {recent.length === 0 ? (
            <p className="text-muted-foreground mt-2 px-1 text-sm">
              Sessions you finish appear here, with every set you did.
            </p>
          ) : (
            <ul className="bg-card mt-2 divide-y rounded-2xl px-4">
              {recent.map((session) => (
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
          )}
        </section>

        <Link href="/training/exercises" className="bg-card flex min-h-16 items-center gap-3 rounded-2xl px-5">
          <Dumbbell className="text-muted-foreground size-5" aria-hidden />
          <span className="flex-1">
            <span className="block font-semibold">Exercise library</span>
            <span className="text-muted-foreground block text-sm">
              Search, filter, find an alternative, see your progress
            </span>
          </span>
          <ArrowRight className="text-muted-foreground size-4" aria-hidden />
        </Link>
      </div>
    </div>
  );
}

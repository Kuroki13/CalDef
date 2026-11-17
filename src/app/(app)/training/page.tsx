import { ArrowRight, CalendarDays, Dumbbell, Play, Plus } from "lucide-react";
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
import { openPlans } from "@/lib/training/plans";
import {
  getActiveSession,
  listPrograms,
  listSchedule,
  listSessionStarts,
  listSessionSummaries,
  listTemplates,
} from "@/lib/training/store";
import type { WorkoutTemplate } from "@/lib/training/types";
import { dayOf, summaryLineOf } from "@/lib/training/view";

export const metadata: Metadata = { title: "Training · CalDef" };

/**
 * The training home: the session first, the statistics after.
 *
 * The slab answers "what do I do now?" with one dominant action, chosen by
 * the state of the account:
 *
 *   a session is running      Resume it — its name, sets done, its clock
 *   a workout is planned today Start it
 *   workouts exist            the list is the choice; Free session beside it
 *   nothing yet               Create my first workout; Free session and the
 *                             exercise library next to it
 *
 * The week is a thin strip under that, and says nothing when there is
 * nothing to say. Exercises and history sit with the actions, not at the
 * bottom of the page.
 */
export default async function TrainingPage() {
  const { profile } = await getAccountSetup();
  if (!profile) return null;

  const today = todayInTimeZone(profile.timezone);
  const monday = startOfIsoWeek(today);

  const [active, templates, programs, recent, plans, starts] = await Promise.all([
    getActiveSession(),
    listTemplates(),
    listPrograms(),
    listSessionSummaries(3),
    listSchedule(monday, addDays(today, 28)),
    // A day either side, because a UTC day is not the user's day.
    listSessionStarts(new Date(Date.parse(`${monday}T00:00:00Z`) - 86_400_000).toISOString()),
  ]);

  const done = starts.map((s) => ({
    id: s.id,
    name: s.name,
    templateId: s.templateId,
    scheduleId: s.scheduleId,
    startedAt: s.startedAt,
    date: todayInTimeZone(profile.timezone, new Date(s.startedAt)),
  }));
  const week = weekOf(today, today, { done, planned: plans });
  const sessionsThisWeek = week.reduce((n, day) => n + day.done.length, 0);
  // A plan carried out is no longer a plan (`lib/training/plans.ts`).
  const upcoming = openPlans(
    plans.filter((plan) => plan.date >= today),
    done,
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

  const plannedToday = active ? null : (upcoming.find((plan) => plan.date === today) ?? null);
  const setsDone = active
    ? active.exercises.reduce((n, e) => n + e.sets.filter((set) => set.completedAt).length, 0)
    : 0;
  const setsTotal = active ? active.exercises.reduce((n, e) => n + e.sets.length, 0) : 0;
  const plannedThisWeek = week.reduce((n, day) => n + day.planned.length, 0);

  return (
    <div className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-8">
      <div className="lg:sticky lg:top-0 lg:col-span-5">
        <Slab size="strip">
          <div className="flex items-baseline justify-between gap-3 pt-2">
            <h1 className="display text-3xl">Training</h1>
            <p className="text-slab-muted text-sm tabular-nums">
              {sessionsThisWeek === 0
                ? plannedThisWeek > 0
                  ? `${plannedThisWeek} planned this week`
                  : "Nothing yet this week"
                : `${sessionsThisWeek} ${sessionsThisWeek === 1 ? "session" : "sessions"} this week`}
            </p>
          </div>

          {/* The one action of the screen, by state. */}
          <div className="mt-4">
            {active ? (
              <Link
                href="/training/session"
                className="bg-volt text-volt-foreground flex min-h-[4.5rem] items-center gap-3 rounded-2xl px-5"
              >
                <Play className="size-6 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-lg leading-tight font-bold">Resume the session</span>
                  <span className="block truncate text-sm opacity-75">
                    {active.name} · {setsDone} of {setsTotal} sets done
                  </span>
                </span>
              </Link>
            ) : plannedToday ? (
              <div className="space-y-1">
                <p className="eyebrow">Planned today</p>
                <StartWorkoutButton
                  templateId={plannedToday.templateId}
                  scheduleId={plannedToday.id}
                  variant="volt"
                  size="lg"
                  className="min-h-[4.25rem] w-full justify-start rounded-2xl px-5 text-lg"
                >
                  Start {plannedToday.name}
                </StartWorkoutButton>
              </div>
            ) : templates.length === 0 ? (
              <Button asChild variant="volt" size="lg" className="min-h-[4.25rem] w-full justify-start rounded-2xl px-5 text-lg">
                <Link href="/training/templates/new">
                  <Plus aria-hidden /> Create my first workout
                </Link>
              </Button>
            ) : (
              <p className="text-slab-muted text-sm">
                Pick a workout below, or start an empty session and add
                exercises as you go.
              </p>
            )}
          </div>

          {/* Secondary actions, together and near the main one. */}
          <div className="mt-3 grid grid-cols-3 gap-2 text-sm font-semibold">
            {active ? (
              <span className="text-slab-muted col-span-1 flex min-h-11 items-center justify-center rounded-xl bg-white/5 px-2 text-center text-xs font-medium">
                One session at a time
              </span>
            ) : (
              <StartWorkoutButton
                sessionName="Free session"
                variant="ghost"
                className="text-slab-foreground min-h-11 w-full rounded-xl bg-white/10 px-2 hover:bg-white/20 hover:text-slab-foreground"
              >
                Free
              </StartWorkoutButton>
            )}
            <Link
              href="/training/exercises"
              className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-white/10 px-2 hover:bg-white/20"
            >
              <Dumbbell className="size-4" aria-hidden /> Exercises
            </Link>
            <Link
              href="/training/history"
              className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-white/10 px-2 hover:bg-white/20"
            >
              <CalendarDays className="size-4" aria-hidden /> History
            </Link>
          </div>

          {sessionsThisWeek > 0 || plannedThisWeek > 0 ? (
            <div className="border-slab-line mt-4 border-t pt-3">
              <WeekStrip week={week} />
            </div>
          ) : null}
        </Slab>
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
          <SectionTitle
            id="workouts-heading"
            action={
              templates.length > 0 ? (
                <Button asChild variant="ghost">
                  <Link href="/training/templates/new">
                    <Plus aria-hidden /> New
                  </Link>
                </Button>
              ) : null
            }
          >
            Workouts
          </SectionTitle>
          {templates.length === 0 ? (
            <div className="mt-2">
              <EmptyState icon={Dumbbell} title="No workouts yet">
                A workout is a list of exercises with their sets, reps and
                rest — &ldquo;Push A&rdquo;, &ldquo;Legs&rdquo;. Create one
                above, or tap Free and add exercises as you go.
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
                        plannedTodayId={
                          upcoming.find((plan) => plan.date === today && plan.templateId === template.id)?.id ?? null
                        }
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
            Recent sessions
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
                        {summaryLineOf(session, profile.unit_system)}
                      </span>
                    </span>
                    <ArrowRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

      </div>
    </div>
  );
}

import { ArrowRight, Dumbbell, History, ListChecks, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState, PageHeader } from "@/components/page-header";
import { StartWorkoutButton } from "@/components/training/start-button";
import { TemplateActions } from "@/components/training/template-actions";
import { Button } from "@/components/ui/button";
import { getAccountSetup } from "@/lib/profile";
import { describeRepTarget } from "@/lib/training/format";
import {
  getActiveSessionSummary,
  listCompletedSessions,
  listTemplates,
} from "@/lib/training/store";
import { dayOf, summaryLine } from "@/lib/training/view";

export const metadata: Metadata = { title: "Training · CalDef" };

/**
 * The training home: resume what is running, start something, look back.
 *
 * Ordered by urgency. A session in progress is the only thing that matters
 * while it exists, so it is first and unmissable; then the workouts to
 * start from; then what was done.
 */
export default async function TrainingPage() {
  const { profile } = await getAccountSetup();
  if (!profile) return null;

  const [active, templates, recent] = await Promise.all([
    getActiveSessionSummary(),
    listTemplates(),
    listCompletedSessions(5),
  ]);

  return (
    <div className="space-y-7">
      <PageHeader
        title="Training"
        description="Your workouts, the session at the gym, and what you lifted last time."
      />

      {active ? (
        <section
          aria-label="Session in progress"
          className="bg-primary text-primary-foreground rounded-2xl p-5"
        >
          <p className="text-primary-foreground/75 text-[0.6875rem] font-semibold tracking-[0.08em] uppercase">
            In progress · started {dayOf(active.startedAt, profile.timezone)}
          </p>
          <p className="mt-1 text-2xl font-bold tracking-tight">{active.name}</p>
          <Button asChild size="lg" variant="secondary" className="mt-4 w-full">
            <Link href="/training/session">
              Resume session <ArrowRight aria-hidden />
            </Link>
          </Button>
        </section>
      ) : null}

      <section aria-labelledby="workouts-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="workouts-heading" className="text-lg font-semibold tracking-tight">
            Workouts
          </h2>
          <Button asChild variant="outline">
            <Link href="/training/templates/new">
              <Plus aria-hidden /> New
            </Link>
          </Button>
        </div>

        {templates.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="No workouts yet"
            action={
              <Button asChild>
                <Link href="/training/templates/new">Create a workout</Link>
              </Button>
            }
          >
            A workout is a reusable plan — &ldquo;Push A&rdquo;, its exercises,
            sets and rest. Create one, or start an empty session below.
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {templates.map((template) => (
              <li key={template.id} className="space-y-3 rounded-2xl border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold">{template.name}</h3>
                    <p className="text-muted-foreground text-xs">
                      {template.items.length}{" "}
                      {template.items.length === 1 ? "exercise" : "exercises"} ·{" "}
                      {template.items.reduce((n, item) => n + item.targetSets, 0)} sets
                    </p>
                  </div>
                  {active ? null : (
                    <StartWorkoutButton templateId={template.id}>Start</StartWorkoutButton>
                  )}
                </div>
                <ol className="text-muted-foreground space-y-0.5 text-sm">
                  {template.items.slice(0, 6).map((item, index) => (
                    <li key={index} className="flex justify-between gap-3">
                      <span className="truncate">{item.exerciseName}</span>
                      <span className="shrink-0 tabular-nums">
                        {item.targetSets} ×{" "}
                        {describeRepTarget(item.repMin, item.repMax)?.replace(" reps", "") ?? "–"}
                      </span>
                    </li>
                  ))}
                  {template.items.length > 6 ? (
                    <li>+ {template.items.length - 6} more</li>
                  ) : null}
                </ol>
                {template.notes ? (
                  <p className="text-muted-foreground text-xs">{template.notes}</p>
                ) : null}
                <div className="-mx-2 -mb-2 border-t px-2 pt-2">
                  <TemplateActions id={template.id} name={template.name} />
                </div>
              </li>
            ))}
          </ul>
        )}

        {active ? (
          <p className="text-muted-foreground text-sm">
            Finish or discard the session in progress to start another.
          </p>
        ) : (
          <StartWorkoutButton sessionName="Workout" variant="outline" size="lg" className="w-full">
            Start an empty session
          </StartWorkoutButton>
        )}
      </section>

      <section aria-labelledby="history-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="history-heading" className="text-lg font-semibold tracking-tight">
            Recent sessions
          </h2>
          {recent.length > 0 ? (
            <Button asChild variant="ghost">
              <Link href="/training/history">
                All <ArrowRight aria-hidden />
              </Link>
            </Button>
          ) : null}
        </div>
        {recent.length === 0 ? (
          <EmptyState icon={History} title="Nothing logged yet">
            Sessions you finish appear here, with every set you did.
          </EmptyState>
        ) : (
          <ul className="divide-y rounded-2xl border bg-card">
            {recent.map((session) => (
              <li key={session.id}>
                <Link
                  href={`/training/history/${session.id}`}
                  className="flex min-h-16 items-center justify-between gap-3 px-4 py-3"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{session.name}</span>
                    <span className="text-muted-foreground block truncate text-xs">
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

      <Link
        href="/training/exercises"
        className="flex min-h-14 items-center gap-3 rounded-2xl border bg-card px-4"
      >
        <Dumbbell className="text-muted-foreground size-5" aria-hidden />
        <span className="flex-1 font-medium">Exercise library</span>
        <ArrowRight className="text-muted-foreground size-4" aria-hidden />
      </Link>
    </div>
  );
}

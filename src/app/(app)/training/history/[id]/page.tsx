import { ArrowLeft, Trash2, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { deleteSessionAction } from "@/app/(app)/training/actions";
import { Slab, Stat } from "@/components/page-header";
import { CompletedSets } from "@/components/training/completed-sets";
import { ConfirmAction } from "@/components/training/confirm-action";
import { StartWorkoutButton } from "@/components/training/start-button";
import { Button } from "@/components/ui/button";
import { getAccountSetup } from "@/lib/profile";
import { formatClock, formatDistance, formatLength, formatWeight } from "@/lib/training/format";
import {
  newRecords,
  sessionSummary,
  volumeKg,
  type PersonalRecord,
} from "@/lib/training/metrics";
import {
  getActiveSessionSummary,
  getExerciseHistory,
  getSession,
} from "@/lib/training/store";
import { dayOf, sessionSeconds } from "@/lib/training/view";
import type { UnitSystem } from "@/lib/units";

/** The tab is named after the session, not "Session". */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const id = Number((await params).id);
  const session = Number.isInteger(id) && id > 0 ? await getSession(id) : null;
  return { title: `${session?.name ?? "Session"} · CalDef` };
}

const RECORD_WORDS: Record<PersonalRecord["kind"], string> = {
  heaviest: "heaviest set",
  estimated_1rm: "best estimated 1-rep max",
  best_volume: "most volume in a session",
  most_reps: "most reps in a set",
  longest: "longest",
  furthest: "furthest",
};

function recordFigure(record: PersonalRecord, units: UnitSystem): string {
  switch (record.kind) {
    case "heaviest":
      return `${formatWeight(record.value, units)} × ${record.reps}`;
    case "estimated_1rm":
      return formatWeight(Math.round(record.value * 10) / 10, units);
    case "best_volume":
      return formatWeight(Math.round(record.value), units);
    case "most_reps":
      return `${record.value} reps`;
    case "longest":
      return formatClock(record.value);
    case "furthest":
      return formatDistance(record.value, units);
  }
}

/**
 * One session as it happened — and, straight after "Finish", its summary.
 *
 * Read from the session's own rows, so it says the same thing whatever has
 * since been done to its workout. Records are listed only where there was
 * an earlier result to beat; a first time is not a record.
 */
export default async function SessionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const { profile } = await getAccountSetup();
  if (!profile) return null;
  const units = profile.unit_system;

  const [session, active] = await Promise.all([getSession(id), getActiveSessionSummary()]);
  if (!session) notFound();
  if (session.status !== "completed") redirect("/training/session");

  const summary = sessionSummary(session.exercises);
  const seconds = sessionSeconds(session);
  const justFinished = (await searchParams).done === "1";

  // One exercise can appear twice in a session; its history is read once.
  const exerciseIds = [...new Set(session.exercises.map((e) => e.exerciseId))];
  const histories = await Promise.all(exerciseIds.map((exerciseId) => getExerciseHistory(exerciseId)));
  const records = exerciseIds.flatMap((exerciseId, i) => {
    const exercise = session.exercises.find((e) => e.exerciseId === exerciseId);
    if (!exercise) return [];
    return newRecords(exercise.measure, histories[i], session.id).map((record) => ({
      exercise: exercise.name,
      record,
    }));
  });

  return (
    <div className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-8">
      <div className="lg:sticky lg:top-0 lg:col-span-5">
        <Slab>
          <Link
            href="/training/history"
            className="text-slab-muted -ml-1 inline-flex min-h-10 items-center gap-1 text-sm font-medium"
          >
            <ArrowLeft className="size-4" aria-hidden /> History
          </Link>
          <p className="eyebrow mt-2">
            {justFinished ? "Session saved · " : ""}
            {dayOf(session.startedAt, profile.timezone)}
          </p>
          <h1 className="display mt-1 text-4xl break-words">{session.name}</h1>
          <dl className="border-slab-line mt-6 grid grid-cols-3 gap-4 border-t pt-5">
            <Stat label="Duration" value={seconds === null ? "—" : formatLength(seconds).replace(" min", "")} unit={seconds !== null && seconds < 3600 ? "min" : undefined} />
            <Stat label="Sets" value={summary.sets} />
            <Stat
              label="Volume"
              value={summary.volumeKg > 0 ? Math.round(units === "imperial" ? summary.volumeKg / 0.45359237 : summary.volumeKg) : "—"}
              unit={summary.volumeKg > 0 ? (units === "imperial" ? "lb" : "kg") : undefined}
            />
          </dl>
          {summary.volumeKg > 0 ? (
            <p className="text-slab-muted mt-3 text-xs">
              Volume is weight × reps, over the exercises that have a load.
            </p>
          ) : null}
        </Slab>

        <div className="mt-4 space-y-2">
          {active ? (
            <p className="text-muted-foreground px-1 text-sm">
              A session is in progress — finish it before repeating this one.
            </p>
          ) : (
            <StartWorkoutButton
              fromSessionId={session.id}
              variant={justFinished ? "outline" : "volt"}
              size="lg"
              className="w-full rounded-2xl"
            >
              Do this session again
            </StartWorkoutButton>
          )}
        </div>
      </div>

      <div className="mt-6 space-y-4 lg:col-span-7 lg:mt-10">
        {records.length > 0 ? (
          <section aria-labelledby="records-heading" className="bg-foreground text-background rounded-2xl p-5">
            <h2 id="records-heading" className="flex items-center gap-2 text-sm font-semibold">
              <Trophy className="text-volt size-5" aria-hidden />
              {records.length === 1 ? "A personal record" : `${records.length} personal records`}
            </h2>
            <ul className="mt-3 space-y-2">
              {records.map(({ exercise, record }) => (
                <li key={`${exercise}-${record.kind}`} className="text-sm">
                  <span className="figure text-volt text-2xl">{recordFigure(record, units)}</span>{" "}
                  <span className="opacity-80">
                    — {exercise}, {RECORD_WORDS[record.kind]}
                    {record.estimated ? " (an estimate)" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {session.notes ? (
          <section className="bg-card rounded-2xl p-5">
            <h2 className="eyebrow">Notes</h2>
            <p className="mt-1 text-sm whitespace-pre-wrap">{session.notes}</p>
          </section>
        ) : null}

        <ol className="space-y-3">
          {session.exercises.map((exercise) => {
            const volume = volumeKg(exercise.measure, exercise.sets);
            return (
              <li key={exercise.id} className="bg-card rounded-2xl px-5 pt-4 pb-2">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="display min-w-0 text-2xl break-words">
                    <Link href={`/training/exercises/${exercise.exerciseId}`}>{exercise.name}</Link>
                  </h2>
                  {volume !== null && volume > 0 ? (
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                      {formatWeight(Math.round(volume), units)}
                    </span>
                  ) : null}
                </div>
                <CompletedSets
                  exerciseName={exercise.name}
                  measure={exercise.measure}
                  sets={exercise.sets}
                  units={units}
                />
                {exercise.notes ? (
                  <p className="text-muted-foreground border-t py-2 text-xs">{exercise.notes}</p>
                ) : null}
              </li>
            );
          })}
        </ol>

        <ConfirmAction
          trigger={
            <Button type="button" variant="ghost" className="text-destructive w-full">
              <Trash2 aria-hidden /> Delete from history
            </Button>
          }
          title="Delete this session?"
          description="Its sets are removed from your history and from each exercise's progress. This cannot be undone."
          confirmLabel="Delete"
          action={deleteSessionAction.bind(null, session.id)}
          redirectTo="/training/history"
        />
      </div>
    </div>
  );
}

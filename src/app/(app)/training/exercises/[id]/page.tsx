import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader, Stat } from "@/components/page-header";
import { EditExercise } from "@/components/training/edit-exercise";
import { ProgressChart } from "@/components/training/progress-chart";
import { getAccountSetup } from "@/lib/profile";
import {
  describeSet,
  distanceToDisplay,
  distanceUnit,
  formatClock,
  formatDistance,
  formatWeight,
  weightToDisplay,
  weightUnit,
} from "@/lib/training/format";
import {
  personalRecords,
  progressSeries,
  type PersonalRecord,
} from "@/lib/training/metrics";
import { getExercise, getExerciseHistory } from "@/lib/training/store";
import {
  EQUIPMENT_LABEL,
  MEASURE_LABEL,
  MUSCLE_LABEL,
  isMuscleGroup,
  type Measure,
} from "@/lib/training/types";
import { dayOf } from "@/lib/training/view";
import type { UnitSystem } from "@/lib/units";

export const metadata: Metadata = { title: "Exercise · CalDef" };

const RECORD_LABEL: Record<PersonalRecord["kind"], string> = {
  heaviest: "Heaviest set",
  estimated_1rm: "Best 1-rep max",
  best_volume: "Most volume in a session",
  most_reps: "Most reps in a set",
  longest: "Longest",
  furthest: "Furthest",
};

function recordValue(record: PersonalRecord, units: UnitSystem): string {
  switch (record.kind) {
    case "heaviest":
      return `${formatWeight(record.value, units)} × ${record.reps}`;
    case "estimated_1rm":
      return formatWeight(Math.round(record.value * 10) / 10, units);
    case "best_volume":
      return formatWeight(Math.round(record.value), units);
    case "most_reps":
      return `${record.value}`;
    case "longest":
      return formatClock(record.value);
    case "furthest":
      return formatDistance(record.value, units);
  }
}

/** What the chart's axis means for each measure, and how to print it. */
function axis(measure: Measure, units: UnitSystem): { caption: string; format: (v: number) => string } {
  switch (measure) {
    case "weight_reps":
      return {
        caption: `Heaviest completed set of each session, in ${weightUnit(units)}.`,
        format: (v) => String(Number(weightToDisplay(v, units).toFixed(1))),
      };
    case "reps":
      return { caption: "Most reps in one set, each session.", format: (v) => String(Math.round(v)) };
    case "duration":
      return { caption: "Longest set of each session.", format: (v) => formatClock(v) };
    case "distance_duration":
      return {
        caption: `Longest distance of each session, in ${distanceUnit(units)}.`,
        format: (v) => String(Number(distanceToDisplay(v, units).toFixed(1))),
      };
  }
}

/**
 * One exercise: what it is, and the user's own history with it.
 *
 * Everything below the description is computed from completed sets of THIS
 * exercise only. Nothing is compared with another machine or variant, and
 * with no sessions there are no figures — the page says so.
 */
export default async function ExercisePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const { profile } = await getAccountSetup();
  if (!profile) return null;
  const units = profile.unit_system;

  const exercise = await getExercise(id);
  if (!exercise) notFound();

  const history = await getExerciseHistory(id);
  const series = progressSeries(exercise.measure, history);
  const records = personalRecords(exercise.measure, history);
  const { caption, format } = axis(exercise.measure, units);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${MUSCLE_LABEL[exercise.muscleGroup]} · ${EQUIPMENT_LABEL[exercise.equipment]}`}
        title={exercise.name}
        description={
          exercise.archived
            ? "Retired — kept for its history, hidden from the picker."
            : exercise.custom
              ? "Your own exercise. Only you can see it."
              : undefined
        }
      />

      <section className="space-y-3 rounded-2xl border bg-card p-4 text-sm">
        {exercise.instructions ? <p>{exercise.instructions}</p> : null}
        <dl className="text-muted-foreground grid gap-1 text-xs">
          <div>
            <dt className="inline font-semibold">Records: </dt>
            <dd className="inline">{MEASURE_LABEL[exercise.measure]}</dd>
          </div>
          {exercise.secondaryMuscles.length > 0 ? (
            <div>
              <dt className="inline font-semibold">Also works: </dt>
              <dd className="inline">
                {exercise.secondaryMuscles
                  .map((m) => (isMuscleGroup(m) ? MUSCLE_LABEL[m] : m))
                  .join(", ")}
              </dd>
            </div>
          ) : null}
          {exercise.aliases.length > 0 ? (
            <div>
              <dt className="inline font-semibold">Also called: </dt>
              <dd className="inline">{exercise.aliases.join(", ")}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {exercise.custom && !exercise.archived ? <EditExercise exercise={exercise} /> : null}

      <section aria-labelledby="progress-heading" className="space-y-3">
        <h2 id="progress-heading" className="text-lg font-semibold tracking-tight">
          Progress
        </h2>
        {history.length === 0 ? (
          <p className="text-muted-foreground rounded-2xl border border-dashed px-4 py-8 text-center text-sm">
            You have not logged this exercise yet. Its progress and records
            appear after your first finished session.
          </p>
        ) : (
          <div className="rounded-2xl border bg-card p-4">
            <ProgressChart points={series} format={format} caption={caption} />
          </div>
        )}
      </section>

      {records.length > 0 ? (
        <section aria-labelledby="records-heading" className="space-y-3">
          <h2 id="records-heading" className="text-lg font-semibold tracking-tight">
            Personal records
          </h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-5 rounded-2xl border bg-card p-4">
            {records.map((record) => (
              <Stat
                key={record.kind}
                label={RECORD_LABEL[record.kind]}
                value={recordValue(record, units)}
                hint={
                  <>
                    {dayOf(record.date, profile.timezone)}
                    {record.estimated ? " · estimated (Epley)" : ""}
                  </>
                }
              />
            ))}
          </dl>
          {records.some((r) => r.estimated) ? (
            <p className="text-muted-foreground text-xs">
              An estimated 1-rep max is computed from a set of several reps
              (weight × (1 + reps ÷ 30), up to 12 reps). It is a guide, not
              a lift you did.
            </p>
          ) : null}
        </section>
      ) : null}

      {history.length > 0 ? (
        <section aria-labelledby="sessions-heading" className="space-y-3">
          <h2 id="sessions-heading" className="text-lg font-semibold tracking-tight">
            Sessions
          </h2>
          <ul className="divide-y rounded-2xl border bg-card">
            {[...history].reverse().map((record) => (
              <li key={record.sessionId}>
                <Link href={`/training/history/${record.sessionId}`} className="block px-4 py-3">
                  <span className="block text-xs font-semibold">
                    {dayOf(record.date, profile.timezone)}
                  </span>
                  <span className="text-muted-foreground block text-sm tabular-nums">
                    {record.sets.map((set) => describeSet(exercise.measure, set, units)).join(" · ")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

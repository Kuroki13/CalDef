import { CircleCheck, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { deleteSessionAction } from "@/app/(app)/training/actions";
import { PageHeader, Stat } from "@/components/page-header";
import { ConfirmAction } from "@/components/training/confirm-action";
import { StartWorkoutButton } from "@/components/training/start-button";
import { Button } from "@/components/ui/button";
import { getAccountSetup } from "@/lib/profile";
import { describeSet, formatLength, formatWeight } from "@/lib/training/format";
import { sessionSummary, volumeKg } from "@/lib/training/metrics";
import { getActiveSessionSummary, getSession } from "@/lib/training/store";
import { dayOf, sessionSeconds } from "@/lib/training/view";

export const metadata: Metadata = { title: "Session · CalDef" };

/**
 * One session as it happened: every exercise, every completed set, the
 * real duration and the notes. Read from the session's own rows, so it
 * says the same thing whatever has since been done to its template.
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

  return (
    <div className="space-y-6">
      {justFinished ? (
        <div
          role="status"
          className="bg-success/10 text-foreground flex items-center gap-3 rounded-2xl p-4"
        >
          <CircleCheck className="text-success size-6 shrink-0" aria-hidden />
          <p className="text-sm font-medium">
            Session saved. Everything below is in your history.
          </p>
        </div>
      ) : null}

      <PageHeader eyebrow={dayOf(session.startedAt, profile.timezone)} title={session.name} />

      <dl className="grid grid-cols-3 gap-4 rounded-2xl border bg-card p-4">
        <Stat label="Duration" value={seconds === null ? "—" : formatLength(seconds)} />
        <Stat label="Sets" value={summary.sets} />
        <Stat
          label="Volume"
          value={summary.volumeKg > 0 ? formatWeight(Math.round(summary.volumeKg), units) : "—"}
          hint={summary.volumeKg > 0 ? "Weight × reps" : undefined}
        />
      </dl>

      {session.notes ? (
        <section className="rounded-2xl border bg-card p-4">
          <h2 className="eyebrow">Notes</h2>
          <p className="mt-1 text-sm whitespace-pre-wrap">{session.notes}</p>
        </section>
      ) : null}

      <ol className="space-y-3">
        {session.exercises.map((exercise) => {
          const volume = volumeKg(exercise.measure, exercise.sets);
          return (
            <li key={exercise.id} className="rounded-2xl border bg-card p-4">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="min-w-0 truncate font-semibold">
                  <Link href={`/training/exercises/${exercise.exerciseId}`} className="hover:underline">
                    {exercise.name}
                  </Link>
                </h2>
                {volume !== null && volume > 0 ? (
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {formatWeight(Math.round(volume), units)}
                  </span>
                ) : null}
              </div>
              <ol className="mt-2 divide-y">
                {exercise.sets.map((set, index) => (
                  <li key={set.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="text-muted-foreground w-6 tabular-nums">{index + 1}</span>
                    <span className="font-medium tabular-nums">
                      {describeSet(exercise.measure, set, units)}
                    </span>
                  </li>
                ))}
              </ol>
              {exercise.notes ? (
                <p className="text-muted-foreground mt-2 text-xs">{exercise.notes}</p>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="space-y-2">
        {active ? (
          <p className="text-muted-foreground text-sm">
            A session is in progress.{" "}
            <Link href="/training/session" className="text-primary font-semibold">
              Resume it
            </Link>{" "}
            before repeating this one.
          </p>
        ) : (
          <StartWorkoutButton fromSessionId={session.id} size="lg" className="w-full">
            Do this session again
          </StartWorkoutButton>
        )}
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

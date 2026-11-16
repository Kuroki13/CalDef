import "server-only";

/**
 * What the Today screen needs to know about training: the session in
 * progress, the workout planned for today, and the last one done.
 */

import { todayInTimeZone, type IsoDate } from "@/lib/dates";
import {
  getActiveSessionSummary,
  getScheduledFor,
  listCompletedSessions,
} from "@/lib/training/store";
import type { WorkoutSession } from "@/lib/training/types";

export type TrainingToday = {
  running: { id: number; name: string; startedAt: string } | null;
  planned: { templateId: number; name: string; detail: string } | null;
  last: WorkoutSession | null;
};

export async function getTrainingToday(
  today: IsoDate,
  timeZone: string,
): Promise<TrainingToday> {
  const [running, scheduled, last] = await Promise.all([
    getActiveSessionSummary(),
    getScheduledFor(today),
    listCompletedSessions(5),
  ]);
  // A plan that has been carried out is no longer a plan: if the workout
  // was done today, Today stops offering to start it.
  const doneToday = new Set(
    last
      .filter((session) => todayInTimeZone(timeZone, new Date(session.startedAt)) === today)
      .map((session) => session.templateId),
  );
  const first = scheduled.find((plan) => !doneToday.has(plan.templateId)) ?? null;
  return {
    running,
    planned: first
      ? {
          templateId: first.templateId,
          name: first.name,
          detail: `${first.exerciseCount} ${first.exerciseCount === 1 ? "exercise" : "exercises"}`,
        }
      : null,
    last: last[0] ?? null,
  };
}

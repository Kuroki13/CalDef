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
import { openPlans } from "@/lib/training/plans";
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
  // A plan that has been carried out is no longer a plan
  // (`lib/training/plans.ts`): Today stops offering to start it.
  const first =
    openPlans(
      scheduled,
      last.map((session) => ({
        templateId: session.templateId,
        startedAt: session.startedAt,
        date: todayInTimeZone(timeZone, new Date(session.startedAt)),
      })),
    )[0] ?? null;
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

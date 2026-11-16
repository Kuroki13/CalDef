/**
 * Small helpers the training pages share for describing a session.
 */

import { formatLongDate, todayInTimeZone } from "@/lib/dates";
import { formatLength, formatWeight } from "@/lib/training/format";
import { sessionSummary } from "@/lib/training/metrics";
import type { WorkoutSession } from "@/lib/training/types";
import type { UnitSystem } from "@/lib/units";

/** The calendar day a moment fell on, where the user lives: "Mon 16 Nov". */
export function dayOf(iso: string, timeZone: string): string {
  return formatLongDate(todayInTimeZone(timeZone, new Date(iso)));
}

/** Real duration of a finished session, in seconds. */
export function sessionSeconds(session: Pick<WorkoutSession, "startedAt" | "endedAt">): number | null {
  if (!session.endedAt) return null;
  return Math.max(0, (Date.parse(session.endedAt) - Date.parse(session.startedAt)) / 1000);
}

/** The same line, from the light figures a list is read with. */
export function summaryLineOf(
  item: { exercises: number; sets: number; volumeKg: number; startedAt: string; endedAt: string | null },
  units: UnitSystem,
): string {
  const seconds = sessionSeconds(item);
  return [
    `${item.exercises} ${item.exercises === 1 ? "exercise" : "exercises"}`,
    `${item.sets} ${item.sets === 1 ? "set" : "sets"}`,
    seconds === null ? null : formatLength(seconds),
    item.volumeKg > 0 ? `${formatWeight(Math.round(item.volumeKg), units)} lifted` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "5 exercises · 16 sets · 52 min · 6 240 kg" — volume only when there is some. */
export function summaryLine(session: WorkoutSession, units: UnitSystem): string {
  const summary = sessionSummary(session.exercises);
  const seconds = sessionSeconds(session);
  return [
    `${summary.exercises} ${summary.exercises === 1 ? "exercise" : "exercises"}`,
    `${summary.sets} ${summary.sets === 1 ? "set" : "sets"}`,
    seconds === null ? null : formatLength(seconds),
    summary.volumeKg > 0 ? `${formatWeight(Math.round(summary.volumeKg), units)} lifted` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

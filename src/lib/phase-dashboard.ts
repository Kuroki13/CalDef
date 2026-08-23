import "server-only";

/**
 * Everything the phase screen shows (spec §8.4 and §8.6).
 *
 * Gathers the phase, the trend, the diary averages and the projection into
 * one shape so the page stays a rendering concern. The projection is
 * deliberately plain — "at your current rate" — because a curve fitted to a
 * few weeks of bodyweight implies confidence the data does not support.
 */

import { type IsoDate, addDays, daysBetween } from "@/lib/dates";
import { getDailyTotals } from "@/lib/diary";
import { type ActivePhase } from "@/lib/phase";
import { meanDailyIntake } from "@/lib/nutrition/totals";
import { loggedDayRatio } from "@/lib/nutrition/totals";
import { daysToReach } from "@/lib/tdee/feasibility";
import { projectWeightKg } from "@/lib/tdee/trend";
import { type WeightHistory } from "@/lib/weight";

export type PhaseDashboard = {
  dayNumber: number;
  totalDays: number;
  daysRemaining: number;
  fractionComplete: number;

  startWeightKg: number;
  currentTrendKg: number | null;
  currentReadingKg: number | null;
  /** Positive means lost. Measured on the trend, not the scale. */
  lostKg: number | null;

  recommendedLowKg: number | null;
  recommendedHighKg: number | null;
  stretchTargetKg: number | null;
  finalGoalWeightKg: number | null;

  trendKgPerWeek: number | null;
  /** Where the current rate lands on day 56. */
  projectedEndWeightKg: number | null;
  /** Days to the final goal at the current rate, when it is being approached. */
  daysToFinalGoal: number | null;

  meanIntakeKcal: number;
  meanProteinG: number;
  adherencePct: number;
  loggedDays: number;
  /** Average weekly trend change across the phase so far. */
  averageWeeklyChangeKg: number | null;

  /** One sentence, safe to show verbatim. Never shaming (spec §8.6). */
  projectionNote: string;
};

export async function getPhaseDashboard(
  active: ActivePhase,
  history: WeightHistory,
  today: IsoDate,
): Promise<PhaseDashboard> {
  const { phase, progress } = active;

  const elapsedDays = Math.max(daysBetween(phase.start_date, today), 0);
  const from = phase.start_date;
  const totalsByDate = await getDailyTotals(from, today);
  const spanDays = elapsedDays + 1;

  const mean = meanDailyIntake([...totalsByDate.values()], spanDays);

  const startWeightKg = Number(phase.start_weight_kg);
  const currentTrendKg = history.latestTrendKg;
  const lostKg =
    currentTrendKg === null ? null : round2(startWeightKg - currentTrendKg);

  const rate = history.changeKgPerWeek;
  const projectedEndWeightKg =
    currentTrendKg === null || rate === null
      ? null
      : projectWeightKg(currentTrendKg, rate, progress.daysRemaining);

  const finalGoalWeightKg =
    phase.final_goal_weight_kg === null
      ? null
      : Number(phase.final_goal_weight_kg);

  const daysToFinalGoal =
    currentTrendKg === null || rate === null || rate >= 0 || finalGoalWeightKg === null
      ? null
      : daysToReach(currentTrendKg, finalGoalWeightKg, rate);

  return {
    dayNumber: progress.dayNumber,
    totalDays: progress.totalDays,
    daysRemaining: progress.daysRemaining,
    fractionComplete: progress.fractionComplete,

    startWeightKg,
    currentTrendKg,
    currentReadingKg: history.latestKg,
    lostKg,

    recommendedLowKg:
      phase.recommended_target_low_kg === null
        ? null
        : Number(phase.recommended_target_low_kg),
    recommendedHighKg:
      phase.recommended_target_high_kg === null
        ? null
        : Number(phase.recommended_target_high_kg),
    stretchTargetKg:
      phase.stretch_target_kg === null ? null : Number(phase.stretch_target_kg),
    finalGoalWeightKg,

    trendKgPerWeek: rate,
    projectedEndWeightKg,
    daysToFinalGoal,

    meanIntakeKcal: mean.kcal,
    meanProteinG: mean.protein_g,
    adherencePct: round1(loggedDayRatio(totalsByDate.size, spanDays) * 100),
    loggedDays: totalsByDate.size,
    averageWeeklyChangeKg: rate,

    projectionNote: describeProjection({
      projectedEndWeightKg,
      stretchTargetKg:
        phase.stretch_target_kg === null
          ? null
          : Number(phase.stretch_target_kg),
      finalGoalWeightKg,
      daysToFinalGoal,
      daysRemaining: progress.daysRemaining,
      rate,
    }),
  };
}

/**
 * The projection sentence from spec §8.6.
 *
 * States the gap between the current trajectory and the stretch target
 * factually, and never characterises the user for the difference.
 */
function describeProjection({
  projectedEndWeightKg,
  stretchTargetKg,
  finalGoalWeightKg,
  daysToFinalGoal,
  daysRemaining,
  rate,
}: {
  projectedEndWeightKg: number | null;
  stretchTargetKg: number | null;
  finalGoalWeightKg: number | null;
  daysToFinalGoal: number | null;
  daysRemaining: number;
  rate: number | null;
}): string {
  if (projectedEndWeightKg === null || rate === null) {
    return "A few more weigh-ins are needed before this phase can be projected.";
  }

  if (rate >= 0) {
    return (
      "Your trend is flat or rising at the moment, so there is no projection " +
      "to make yet. That is common early in a phase, and often in the week " +
      "after a change in routine."
    );
  }

  const parts = [
    `At your current rate you are projected to reach approximately ` +
      `${projectedEndWeightKg} kg by the end of this phase` +
      (daysRemaining > 0 ? `, ${daysRemaining} days from now.` : "."),
  ];

  if (stretchTargetKg !== null && projectedEndWeightKg > stretchTargetKg) {
    parts.push(
      `${stretchTargetKg} kg would need a faster loss rate than your data ` +
        "currently supports.",
    );
  }

  if (finalGoalWeightKg !== null && daysToFinalGoal !== null) {
    parts.push(
      `At this pace ${finalGoalWeightKg} kg is about ` +
        `${Math.round(daysToFinalGoal / 7)} weeks away.`,
    );
  }

  return parts.join(" ");
}

/** Milestone dates for the phase, for the checkpoint list (spec §8.10). */
export function checkpointDates(
  startDate: IsoDate,
  days: readonly number[],
): { day: number; date: IsoDate }[] {
  return days.map((day) => ({ day, date: addDays(startDate, day - 1) }));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

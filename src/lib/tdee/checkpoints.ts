/**
 * Phase checkpoints and the reports they produce (spec §8.10).
 *
 * Day 1 baseline · day 7 · day 14 · day 28 halfway · day 42 · day 56 final.
 *
 * The spec asks for an AI-written explanation of progress in the halfway and
 * final reports. The explanation produced here is deterministic, because
 * ARCHITECTURE invariant 3 requires the app to work with the AI switched
 * off — a report that only exists when Gemini answers is not a report. The
 * AI layer may enrich this text later; it may not become a precondition for
 * having one.
 */

import { type IsoDate, addDays, daysBetween } from "@/lib/dates";
import { CHECKPOINT_DAYS } from "@/lib/tdee/milestones";

export type CheckpointKind = "baseline" | "progress" | "halfway" | "final";

export type Checkpoint = {
  day: number;
  date: IsoDate;
  kind: CheckpointKind;
  /** True once the phase has reached this day. */
  reached: boolean;
};

export function checkpointKind(day: number, totalDays: number): CheckpointKind {
  if (day <= 1) return "baseline";
  if (day >= totalDays) return "final";
  if (day * 2 >= totalDays && (day - 1) * 2 < totalDays) return "halfway";
  return "progress";
}

/**
 * The checkpoint schedule for a phase.
 *
 * Uses the spec's fixed days for a 56-day phase. A phase of another length
 * keeps the same shape — start, quarters, halfway, three-quarters, end —
 * rather than dropping checkpoints that fall past its end.
 */
export function checkpointsFor(
  startDate: IsoDate,
  totalDays: number,
  today: IsoDate,
): Checkpoint[] {
  const days =
    totalDays === 56
      ? [...CHECKPOINT_DAYS]
      : dedupe([
          1,
          Math.round(totalDays * 0.125),
          Math.round(totalDays * 0.25),
          Math.round(totalDays * 0.5),
          Math.round(totalDays * 0.75),
          totalDays,
        ]);

  const elapsed = daysBetween(startDate, today) + 1;

  return days
    .filter((day) => day >= 1 && day <= totalDays)
    .map((day) => ({
      day,
      date: addDays(startDate, day - 1),
      kind: checkpointKind(day, totalDays),
      reached: elapsed >= day,
    }));
}

/**
 * The longest run of consecutive logged days (spec §8.10, "best adherence
 * streak").
 *
 * Measured on dates rather than on a count, because seven logged days
 * scattered across a fortnight is not a streak.
 */
export function bestLoggedStreak(loggedDates: readonly IsoDate[]): number {
  if (loggedDates.length === 0) return 0;

  const sorted = [...new Set(loggedDates)].sort();
  let best = 1;
  let run = 1;

  for (let i = 1; i < sorted.length; i++) {
    run = daysBetween(sorted[i - 1], sorted[i]) === 1 ? run + 1 : 1;
    if (run > best) best = run;
  }

  return best;
}

export type PhaseReportInput = {
  kind: CheckpointKind;
  dayNumber: number;
  totalDays: number;
  startWeightKg: number;
  currentTrendKg: number | null;
  projectedEndWeightKg: number | null;
  recommendedLowKg: number | null;
  recommendedHighKg: number | null;
  stretchTargetKg: number | null;
  finalGoalWeightKg: number | null;
  /**
   * Averaged over the days actually logged, not over elapsed days.
   *
   * The expenditure model deliberately divides by elapsed days, because an
   * unlogged day there would read as fasting and inflate the estimate. A
   * report is answering a different question — "what did you eat" — and
   * dividing 20 logged days by a 56-day phase would tell the user they ate
   * 715 kcal a day, which they did not. The logged-day count is stated
   * alongside so the figure cannot be mistaken for full coverage.
   */
  meanIntakeKcal: number;
  meanProteinG: number;
  estimatedTdeeKcal: number | null;
  trendKgPerWeek: number | null;
  bestStreakDays: number;
  loggedDays: number;
};

export type PhaseReport = {
  kind: CheckpointKind;
  headline: string;
  /** Paragraphs, already safe to render verbatim. */
  body: string[];
  lostKg: number | null;
  percentBodyweightLost: number | null;
  averageWeeklyLossKg: number | null;
};

/**
 * Builds the narrative for a checkpoint.
 *
 * Every sentence here describes the data. None of it characterises the
 * person: spec §8.6 forbids shaming for a missed stretch target, and that
 * restraint applies to the reports as much as to the dashboard.
 */
export function buildPhaseReport(input: PhaseReportInput): PhaseReport {
  const {
    kind,
    dayNumber,
    totalDays,
    startWeightKg,
    currentTrendKg,
    projectedEndWeightKg,
    recommendedLowKg,
    recommendedHighKg,
    stretchTargetKg,
    finalGoalWeightKg,
    meanIntakeKcal,
    meanProteinG,
    estimatedTdeeKcal,
    trendKgPerWeek,
    bestStreakDays,
    loggedDays,
  } = input;

  const lostKg =
    currentTrendKg === null ? null : round2(startWeightKg - currentTrendKg);
  const percentBodyweightLost =
    lostKg === null || startWeightKg <= 0
      ? null
      : round2((lostKg / startWeightKg) * 100);
  const averageWeeklyLossKg =
    lostKg === null || dayNumber <= 1 ? null : round3((lostKg / (dayNumber - 1)) * 7);

  const body: string[] = [];

  if (currentTrendKg === null) {
    return {
      kind,
      headline: headlineFor(kind, dayNumber, totalDays),
      body: [
        "There are not enough weigh-ins yet to summarise this phase. " +
          "Weighing in daily gives the trend something to work with.",
      ],
      lostKg: null,
      percentBodyweightLost: null,
      averageWeeklyLossKg: null,
    };
  }

  body.push(
    `You started at ${startWeightKg} kg and your trend is now ` +
      `${currentTrendKg} kg — ${describeChange(lostKg)}` +
      (percentBodyweightLost !== null && kind === "final"
        ? `, or ${Math.abs(percentBodyweightLost)}% of your starting bodyweight`
        : "") +
      ".",
  );

  if (averageWeeklyLossKg !== null) {
    body.push(
      `That averages ${Math.abs(averageWeeklyLossKg)} kg a week over ` +
        `${dayNumber - 1} days.` +
        (trendKgPerWeek !== null
          ? ` Your rate over the last four weeks is ${Math.abs(round2(trendKgPerWeek))} kg a week.`
          : ""),
    );
  }

  body.push(
    loggedDays === 0
      ? "No food was logged during this phase, so there is nothing to report " +
          "about intake."
      : `Across the ${loggedDays} days you logged, you averaged ` +
        `${Math.round(meanIntakeKcal)} kcal and ${Math.round(meanProteinG)} g ` +
        "of protein a day" +
        (estimatedTdeeKcal !== null
          ? `, against an estimated expenditure of ${Math.round(estimatedTdeeKcal)} kcal`
          : "") +
        `. Your best unbroken run was ${bestStreakDays} days.`,
  );

  if (kind !== "final" && projectedEndWeightKg !== null) {
    body.push(
      `At this rate you are on course for about ${projectedEndWeightKg} kg by ` +
        `day ${totalDays}` +
        (recommendedLowKg !== null && recommendedHighKg !== null
          ? `, against a recommended range of ${recommendedLowKg}–${recommendedHighKg} kg`
          : "") +
        ".",
    );
  }

  if (stretchTargetKg !== null && projectedEndWeightKg !== null) {
    body.push(
      projectedEndWeightKg <= stretchTargetKg
        ? `That is at or past your ${stretchTargetKg} kg stretch target.`
        : `Your ${stretchTargetKg} kg stretch target would need a faster rate ` +
          "than your data supports. It stays on the chart as a marker, not a " +
          "requirement.",
    );
  }

  if (kind === "final" && finalGoalWeightKg !== null) {
    body.push(
      `${finalGoalWeightKg} kg remains the long-term goal. The next phase ` +
        "picks up from where this one finished, with a target set from what " +
        "this phase actually showed about your body.",
    );
  }

  return {
    kind,
    headline: headlineFor(kind, dayNumber, totalDays),
    body,
    lostKg,
    percentBodyweightLost,
    averageWeeklyLossKg,
  };
}

function headlineFor(
  kind: CheckpointKind,
  dayNumber: number,
  totalDays: number,
): string {
  switch (kind) {
    case "baseline":
      return "Day 1 — baseline";
    case "halfway":
      return `Halfway — day ${dayNumber} of ${totalDays}`;
    case "final":
      return `Final report — day ${totalDays}`;
    case "progress":
      return `Day ${dayNumber} check-in`;
  }
}

/** Neutral phrasing for a gain, a loss, or no movement. */
function describeChange(lostKg: number | null): string {
  if (lostKg === null) return "no change recorded";
  if (Math.abs(lostKg) < 0.05) return "level so far";
  return lostKg > 0 ? `down ${lostKg} kg` : `up ${Math.abs(lostKg)} kg`;
}

function dedupe(days: number[]): number[] {
  return [...new Set(days)].sort((a, b) => a - b);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Weekly milestones for a cut phase.
 *
 * Spec 8.5 is explicit that these are *not* a flat kilogram subtracted per
 * week. They are generated from the recommended rate — which is itself
 * derived from bodyweight — and recomputed as real data arrives, so the
 * roadmap bends as the trend does.
 *
 * The recommended path and the stretch path are produced separately and must
 * stay visually distinct (spec 8.7). The stretch line is aspirational and
 * never feeds a calorie target.
 */

import { type IsoDate, addDays, daysBetween } from "@/lib/dates";
import { RECOMMENDED_RATE } from "@/lib/tdee/constants";

export type Milestone = {
  weekNumber: number;
  date: IsoDate;
  /** The recommended trajectory — what the plan actually targets. */
  recommendedWeightKg: number;
  /** The stretch trajectory, when a stretch target is set. */
  stretchWeightKg: number | null;
  /** The smoothed trend on that date, once it is in the past. */
  actualTrendWeightKg: number | null;
};

export type MilestoneInput = {
  startDate: IsoDate;
  startWeightKg: number;
  durationDays: number;
  /**
   * Recommended loss rate, kg/week, as a positive magnitude. Supply the
   * adaptive figure once it exists; otherwise the band's top applies.
   */
  recommendedKgPerWeek?: number;
  stretchTargetKg?: number | null;
  /** Smoothed trend by date, for backfilling weeks already elapsed. */
  trendByDate?: ReadonlyMap<IsoDate, number>;
};

/**
 * Builds the week-by-week roadmap, week 0 being the starting point.
 *
 * With the spec's 111.8 kg start and no adaptive figure yet, the default rate
 * is 1% of bodyweight — 1.118 kg/week — which produces 110.7, 109.6, 108.5 …
 * and lands at ~102.9 kg in week 8. That is the roadmap in spec 8.5.
 */
export function buildMilestones({
  startDate,
  startWeightKg,
  durationDays,
  recommendedKgPerWeek,
  stretchTargetKg = null,
  trendByDate,
}: MilestoneInput): Milestone[] {
  const weeks = Math.floor(durationDays / 7);
  const rate =
    recommendedKgPerWeek !== undefined
      ? Math.abs(recommendedKgPerWeek)
      : startWeightKg * RECOMMENDED_RATE.max;

  // The stretch path is a straight line to the stretch target over the phase,
  // whatever rate that implies — it is a goalpost, not a prescription.
  const stretchPerWeek =
    stretchTargetKg !== null && weeks > 0
      ? (startWeightKg - stretchTargetKg) / weeks
      : null;

  const milestones: Milestone[] = [];

  for (let week = 0; week <= weeks; week++) {
    const date = addDays(startDate, week * 7);
    milestones.push({
      weekNumber: week,
      date,
      recommendedWeightKg: round2(startWeightKg - rate * week),
      stretchWeightKg:
        stretchPerWeek === null
          ? null
          : round2(startWeightKg - stretchPerWeek * week),
      actualTrendWeightKg: trendByDate?.get(date) ?? null,
    });
  }

  return milestones;
}

export type PhaseProgress = {
  /** 1-based, as the dashboard shows it: "day 12 of 56". */
  dayNumber: number;
  totalDays: number;
  daysRemaining: number;
  /** 0–1. */
  fractionComplete: number;
  isComplete: boolean;
};

/** Where a phase stands on a given date (spec 8.4). */
export function phaseProgress(
  startDate: IsoDate,
  durationDays: number,
  today: IsoDate,
): PhaseProgress {
  const elapsed = daysBetween(startDate, today);
  const dayNumber = clamp(elapsed + 1, 1, durationDays);
  const daysRemaining = Math.max(durationDays - elapsed, 0);

  return {
    dayNumber,
    totalDays: durationDays,
    daysRemaining,
    fractionComplete: clamp(elapsed / durationDays, 0, 1),
    isComplete: elapsed >= durationDays,
  };
}

/** The checkpoint days the spec calls out (8.10). */
export const CHECKPOINT_DAYS = [1, 7, 14, 28, 42, 56] as const;

export function isCheckpointDay(dayNumber: number): boolean {
  return (CHECKPOINT_DAYS as readonly number[]).includes(dayNumber);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

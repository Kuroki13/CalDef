/**
 * Feasibility and the safety guardrail.
 *
 * These are two separate jobs and the spec is emphatic that they stay
 * separate (§8.2, ARCHITECTURE §7):
 *
 *   `assessTarget`    — what the target the user asked for actually requires.
 *                       Honest arithmetic, however unflattering.
 *   `recommendPlan`   — what the app is willing to recommend. Always inside
 *                       the safe band, whatever the arithmetic said.
 *
 * The UI shows both. That is the point: the user sees that 99 kg in 8 weeks
 * needs ~1760 kcal/day of deficit *and* that we are recommending a rate that
 * lands nearer 103 kg, with no shaming language in between.
 */

import { type IsoDate, daysBetween } from "@/lib/dates";
import {
  CALORIE_FLOOR,
  KCAL_PER_KG,
  type RateClassification,
  RATE_BANDS,
  RECOMMENDED_RATE,
} from "@/lib/tdee/constants";

export type TargetAssessment = {
  /** Kilograms to lose. Negative when the target is above current weight. */
  differenceKg: number;
  daysRemaining: number;
  weeksRemaining: number;
  requiredKgPerWeek: number;
  /** Required rate as a fraction of bodyweight per week. */
  requiredPctPerWeek: number;
  /** The deficit the arithmetic demands, kcal/day. */
  requiredDeficitKcal: number;
  /** Intake that deficit implies at the given expenditure. May be absurd. */
  impliedIntakeKcal: number;
  classification: RateClassification;
  /** False when no sane calorie target could deliver this. */
  isAchievable: boolean;
  /** One sentence, safe to show verbatim. */
  summary: string;
};

/** Where a rate falls in the guardrail bands (spec 8.3). */
export function classifyRate(pctPerWeek: number): RateClassification {
  const rate = Math.abs(pctPerWeek);
  if (rate < RATE_BANDS.slow) return "slow";
  if (rate <= RATE_BANDS.typical) return "typical";
  if (rate <= RATE_BANDS.aggressive) return "aggressive";
  return "very_aggressive";
}

export const RATE_LABELS: Record<RateClassification, string> = {
  slow: "Slow",
  typical: "Typical effective fat-loss range",
  aggressive: "Aggressive",
  very_aggressive: "Very aggressive — worth reviewing",
};

export type AssessTargetInput = {
  currentWeightKg: number;
  targetWeightKg: number;
  startDate: IsoDate;
  targetDate: IsoDate;
  tdeeKcal: number;
};

/**
 * What a target requires. Reports the arithmetic without softening it, and
 * without letting it become a recommendation.
 */
export function assessTarget({
  currentWeightKg,
  targetWeightKg,
  startDate,
  targetDate,
  tdeeKcal,
}: AssessTargetInput): TargetAssessment {
  const daysRemaining = Math.max(daysBetween(startDate, targetDate), 0);
  const differenceKg = round2(currentWeightKg - targetWeightKg);
  const weeksRemaining = round2(daysRemaining / 7);

  if (daysRemaining === 0) {
    return {
      differenceKg,
      daysRemaining: 0,
      weeksRemaining: 0,
      requiredKgPerWeek: 0,
      requiredPctPerWeek: 0,
      requiredDeficitKcal: 0,
      impliedIntakeKcal: tdeeKcal,
      classification: "slow",
      isAchievable: differenceKg <= 0,
      summary: "The target date has arrived.",
    };
  }

  const requiredKgPerWeek = round3((differenceKg / daysRemaining) * 7);
  const requiredPctPerWeek =
    currentWeightKg > 0 ? requiredKgPerWeek / currentWeightKg : 0;
  const requiredDeficitKcal = round1(
    (differenceKg * KCAL_PER_KG) / daysRemaining,
  );
  const impliedIntakeKcal = round1(tdeeKcal - requiredDeficitKcal);
  const classification = classifyRate(requiredPctPerWeek);

  // Achievable asks whether *any* sane intake could deliver this, so it tests
  // the absolute floor rather than the recommendation floor. The distinction
  // is what separates the spec's two worked examples: 99 kg implies ~1597
  // kcal — punishing, and classified very aggressive, but a real number —
  // while 90 kg implies ~359 kcal, which is not a diet at all.
  const isAchievable =
    differenceKg <= 0 || impliedIntakeKcal >= CALORIE_FLOOR.absolute;

  return {
    differenceKg,
    daysRemaining,
    weeksRemaining,
    requiredKgPerWeek,
    requiredPctPerWeek,
    requiredDeficitKcal,
    impliedIntakeKcal,
    classification,
    isAchievable,
    summary: summarize({
      differenceKg,
      requiredKgPerWeek,
      classification,
      isAchievable,
      weeksRemaining,
    }),
  };
}

function summarize({
  differenceKg,
  requiredKgPerWeek,
  classification,
  isAchievable,
  weeksRemaining,
}: {
  differenceKg: number;
  requiredKgPerWeek: number;
  classification: RateClassification;
  isAchievable: boolean;
  weeksRemaining: number;
}): string {
  if (differenceKg <= 0) {
    return "You are already at or below this target.";
  }
  if (!isAchievable) {
    return (
      `Losing ${differenceKg} kg in ${weeksRemaining} weeks is not a ` +
      "realistic fat-loss target for this timeframe. It stays the " +
      "long-term goal, and this phase works toward an intermediate one."
    );
  }
  return (
    `${differenceKg} kg in ${weeksRemaining} weeks means ` +
    `${requiredKgPerWeek} kg per week — ${RATE_LABELS[classification].toLowerCase()}.`
  );
}

/** The lowest intake the app will recommend at a given expenditure. */
export function calorieFloorFor(tdeeKcal: number): number {
  return Math.max(
    CALORIE_FLOOR.absolute,
    Math.round(tdeeKcal * CALORIE_FLOOR.fractionOfTdee),
  );
}

export type RecommendedPlan = {
  /** The rate the app recommends, kg/week. Negative means losing. */
  recommendedKgPerWeek: number;
  recommendedPctPerWeek: number;
  recommendedCalories: number;
  /** Projected weight at the end of the window, at the recommended rate. */
  projectedEndWeightKg: number;
  /** Range from the slow and fast ends of the recommended band. */
  projectedRangeKg: { low: number; high: number };
  /** True when the requested target was reduced to stay inside the band. */
  wasConstrained: boolean;
  /** Date the *requested* target would be reached at the recommended rate. */
  projectedGoalDate: IsoDate | null;
  explanation: string;
};

export type RecommendPlanInput = AssessTargetInput & {
  assessment?: TargetAssessment;
};

/**
 * What the app recommends.
 *
 * Never returns a rate above the top of the recommended band, and never a
 * calorie figure below the floor — regardless of what the requested target
 * demands. This is the function that turns spec 8.2's "do not recommend 1600
 * kcal merely because the arithmetic produces it" into behaviour.
 */
export function recommendPlan(input: RecommendPlanInput): RecommendedPlan {
  const assessment = input.assessment ?? assessTarget(input);
  const { currentWeightKg, tdeeKcal, targetWeightKg } = input;

  // Nothing to lose: recommend maintenance rather than a deficit.
  if (assessment.differenceKg <= 0) {
    return {
      recommendedKgPerWeek: 0,
      recommendedPctPerWeek: 0,
      recommendedCalories: Math.round(tdeeKcal),
      projectedEndWeightKg: round2(currentWeightKg),
      projectedRangeKg: {
        low: round2(currentWeightKg),
        high: round2(currentWeightKg),
      },
      wasConstrained: false,
      projectedGoalDate: null,
      explanation:
        "You are at or below this target, so this plan holds your weight " +
        "rather than reducing it.",
    };
  }

  const maxKgPerWeek = currentWeightKg * RECOMMENDED_RATE.max;
  const minKgPerWeek = currentWeightKg * RECOMMENDED_RATE.min;

  // The requested rate is honoured only while it sits inside the band.
  const recommendedKgPerWeek = Math.min(
    assessment.requiredKgPerWeek,
    maxKgPerWeek,
  );
  const wasConstrained = assessment.requiredKgPerWeek > maxKgPerWeek;

  const deficit = (recommendedKgPerWeek * KCAL_PER_KG) / 7;
  const floor = calorieFloorFor(tdeeKcal);
  // Rounded up, never down. Rounding a calorie target toward less food would
  // push the resulting rate a hair past the top of the recommended band,
  // which is the one direction this function must never drift.
  const recommendedCalories = Math.max(Math.ceil(tdeeKcal - deficit), floor);

  // If the floor bit, the achievable rate is lower than the band's top.
  const effectiveKgPerWeek = round3(
    ((tdeeKcal - recommendedCalories) * 7) / KCAL_PER_KG,
  );

  const days = assessment.daysRemaining;
  const projectedEndWeightKg = round2(
    currentWeightKg - (effectiveKgPerWeek * days) / 7,
  );
  const projectedRangeKg = {
    low: round2(currentWeightKg - (maxKgPerWeek * days) / 7),
    high: round2(currentWeightKg - (minKgPerWeek * days) / 7),
  };

  return {
    recommendedKgPerWeek: -effectiveKgPerWeek,
    recommendedPctPerWeek:
      currentWeightKg > 0 ? effectiveKgPerWeek / currentWeightKg : 0,
    recommendedCalories,
    projectedEndWeightKg,
    projectedRangeKg,
    wasConstrained,
    projectedGoalDate: null,
    explanation: explainPlan({
      wasConstrained,
      assessment,
      projectedEndWeightKg,
      targetWeightKg,
      recommendedCalories,
    }),
  };
}

function explainPlan({
  wasConstrained,
  assessment,
  projectedEndWeightKg,
  targetWeightKg,
  recommendedCalories,
}: {
  wasConstrained: boolean;
  assessment: TargetAssessment;
  projectedEndWeightKg: number;
  targetWeightKg: number;
  recommendedCalories: number;
}): string {
  if (!wasConstrained) {
    return (
      `${recommendedCalories} kcal a day puts you on track for ` +
      `${targetWeightKg} kg, at a rate inside the effective range.`
    );
  }
  return (
    "Your target date is more aggressive than the recommended rate " +
    "supported by your current data. At a sustainable pace you are " +
    `projected to reach approximately ${projectedEndWeightKg} kg by then, ` +
    `rather than ${targetWeightKg} kg. ${assessment.differenceKg} kg would ` +
    "need a significantly faster loss rate than is advisable."
  );
}

/**
 * Days to reach a goal at a given rate. Null when the rate never gets there.
 *
 * Used for "90 kg stays the long-term goal — here is when you would reach it"
 * (spec 8.2).
 */
export function daysToReach(
  currentWeightKg: number,
  goalWeightKg: number,
  kgPerWeek: number,
): number | null {
  const toLose = currentWeightKg - goalWeightKg;
  if (toLose <= 0) return 0;
  const rate = Math.abs(kgPerWeek);
  if (rate <= 0) return null;
  return Math.ceil((toLose / rate) * 7);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

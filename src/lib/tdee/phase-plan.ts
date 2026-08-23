/**
 * Planning a 2-Month Cut phase (spec §8).
 *
 * Pure. Given where someone is and what they are aiming at, this produces
 * the whole shape of a phase: the recommended end-of-phase range, the
 * stretch line, the starting calorie and protein targets, and the weekly
 * roadmap.
 *
 * The safety split from ARCHITECTURE §7 carries through unchanged. The
 * stretch target is reported honestly — including when the arithmetic it
 * demands is unreasonable — but it never produces the calorie number. That
 * comes from `recommendPlan`, which cannot return a rate above the band or
 * a figure below the floor.
 */

import { type IsoDate, addDays } from "@/lib/dates";
import { proteinTargetG } from "@/lib/nutrition/macros";
import { RECOMMENDED_RATE } from "@/lib/tdee/constants";
import {
  type Milestone,
  buildMilestones,
} from "@/lib/tdee/milestones";
import {
  type RecommendedPlan,
  type TargetAssessment,
  assessTarget,
  recommendPlan,
} from "@/lib/tdee/feasibility";

/** Spec §8: fixed duration, eight weeks. */
export const DEFAULT_PHASE_DAYS = 56;

export type PhasePlanInput = {
  startDate: IsoDate;
  /** Defaults to the spec's 56 days. */
  durationDays?: number;
  /** The smoothed trend weight, never a raw reading. */
  startWeightKg: number;
  tdeeKcal: number;
  proteinGPerKg: number;
  /** The long-horizon goal, e.g. 90 kg. Displayed, never prescribed for. */
  finalGoalWeightKg: number | null;
  /** The aspirational end-of-phase figure, e.g. 99 kg. */
  stretchTargetKg: number | null;
};

export type PhasePlan = {
  startDate: IsoDate;
  endDate: IsoDate;
  durationDays: number;
  startWeightKg: number;

  /** What the app expects at a sustainable rate — the honest projection. */
  recommendedTargetLowKg: number;
  recommendedTargetHighKg: number;
  stretchTargetKg: number | null;
  finalGoalWeightKg: number | null;

  initialTdeeKcal: number;
  initialTargetKcal: number;
  initialProteinG: number;
  /** Positive magnitude, kg/week. */
  recommendedKgPerWeek: number;

  milestones: Milestone[];
  /** The unsoftened arithmetic for the stretch target, when one is set. */
  stretchAssessment: TargetAssessment | null;
  /** The arithmetic for the final goal over this window, when one is set. */
  finalGoalAssessment: TargetAssessment | null;
  plan: RecommendedPlan;
  explanation: string;
};

export function planPhase({
  startDate,
  durationDays = DEFAULT_PHASE_DAYS,
  startWeightKg,
  tdeeKcal,
  proteinGPerKg,
  finalGoalWeightKg,
  stretchTargetKg,
}: PhasePlanInput): PhasePlan {
  if (startWeightKg <= 0 || tdeeKcal <= 0) {
    throw new Error("Start weight and expenditure must be positive.");
  }
  if (durationDays < 7) {
    throw new Error("A phase must span at least a week.");
  }

  const endDate = addDays(startDate, durationDays);

  // The target the recommendation is computed against. The stretch figure is
  // used as the *ask*; recommendPlan is what decides whether that ask
  // survives contact with the guardrails.
  const askKg = stretchTargetKg ?? finalGoalWeightKg ?? startWeightKg;

  const shared = {
    currentWeightKg: startWeightKg,
    startDate,
    targetDate: endDate,
    tdeeKcal,
  };

  const stretchAssessment =
    stretchTargetKg === null
      ? null
      : assessTarget({ ...shared, targetWeightKg: stretchTargetKg });

  const finalGoalAssessment =
    finalGoalWeightKg === null
      ? null
      : assessTarget({ ...shared, targetWeightKg: finalGoalWeightKg });

  const plan = recommendPlan({ ...shared, targetWeightKg: askKg });

  const recommendedKgPerWeek = Math.abs(plan.recommendedKgPerWeek);

  return {
    startDate,
    endDate,
    durationDays,
    startWeightKg: round2(startWeightKg),

    // Ordered low-to-high to satisfy the cut_phases_recommended_range check.
    recommendedTargetLowKg: plan.projectedRangeKg.low,
    recommendedTargetHighKg: plan.projectedRangeKg.high,
    stretchTargetKg,
    finalGoalWeightKg,

    initialTdeeKcal: round1(tdeeKcal),
    initialTargetKcal: plan.recommendedCalories,
    initialProteinG: proteinTargetG(startWeightKg, proteinGPerKg),
    recommendedKgPerWeek: round3(recommendedKgPerWeek),

    milestones: buildMilestones({
      startDate,
      startWeightKg,
      durationDays,
      recommendedKgPerWeek,
      stretchTargetKg,
    }),

    stretchAssessment,
    finalGoalAssessment,
    plan,
    explanation: explainPhase({
      plan,
      stretchTargetKg,
      finalGoalWeightKg,
      finalGoalAssessment,
    }),
  };
}

/**
 * The sentence shown when a phase is created.
 *
 * Spec §8.6 is explicit: never shame the user for missing the stretch
 * target. This states the gap and keeps the long-term goal in view.
 */
function explainPhase({
  plan,
  stretchTargetKg,
  finalGoalWeightKg,
  finalGoalAssessment,
}: {
  plan: RecommendedPlan;
  stretchTargetKg: number | null;
  finalGoalWeightKg: number | null;
  finalGoalAssessment: TargetAssessment | null;
}): string {
  const parts: string[] = [];

  if (plan.wasConstrained) {
    parts.push(
      "Your target is more aggressive than the rate your current data " +
        `supports, so this phase aims for about ${plan.projectedEndWeightKg} kg ` +
        "at a sustainable pace.",
    );
    if (stretchTargetKg !== null) {
      parts.push(
        `${stretchTargetKg} kg stays on the chart as a stretch line.`,
      );
    }
  } else {
    parts.push(plan.explanation);
  }

  if (
    finalGoalWeightKg !== null &&
    finalGoalAssessment !== null &&
    !finalGoalAssessment.isAchievable
  ) {
    parts.push(
      `${finalGoalWeightKg} kg remains the long-term goal; this phase is a ` +
        "step toward it, not an attempt to reach it.",
    );
  }

  return parts.join(" ");
}

export type PhaseTwoProposal = {
  /** Where the next phase would start from. */
  startWeightKg: number;
  finalGoalWeightKg: number;
  /** Suggested length, in days. */
  durationDays: number;
  /** Where that length lands at a sustainable rate. */
  projectedEndWeightKg: number;
  /** Days to the final goal at that rate, from the end of the next phase. */
  daysToGoal: number | null;
  /** True when the goal is reachable inside a single further phase. */
  goalWithinOnePhase: boolean;
  explanation: string;
};

/**
 * Proposes the next phase (spec §8.10).
 *
 * The timeframe is adaptive rather than another automatic 56 days: if the
 * remaining distance can be covered sooner at a sustainable rate, the phase
 * is shorter, and if it cannot, the proposal says how far this one gets
 * instead of pretending the goal is in range.
 */
export function proposePhaseTwo({
  currentWeightKg,
  finalGoalWeightKg,
  observedKgPerWeek,
  maxDurationDays = DEFAULT_PHASE_DAYS,
}: {
  currentWeightKg: number;
  finalGoalWeightKg: number;
  /** The rate this phase actually achieved. Positive magnitude. */
  observedKgPerWeek: number;
  maxDurationDays?: number;
}): PhaseTwoProposal {
  const remainingKg = round2(currentWeightKg - finalGoalWeightKg);

  // Fall back to the band's top when the last phase produced no usable rate,
  // rather than proposing a phase that never moves.
  const rate =
    observedKgPerWeek > 0.05
      ? observedKgPerWeek
      : currentWeightKg * RECOMMENDED_RATE.max;

  if (remainingKg <= 0) {
    return {
      startWeightKg: round2(currentWeightKg),
      finalGoalWeightKg,
      durationDays: maxDurationDays,
      projectedEndWeightKg: round2(currentWeightKg),
      daysToGoal: 0,
      goalWithinOnePhase: true,
      explanation:
        "You are at or past your long-term goal. A maintenance phase makes " +
        "more sense than another cut.",
    };
  }

  const daysNeeded = Math.ceil((remainingKg / rate) * 7);
  const goalWithinOnePhase = daysNeeded <= maxDurationDays;
  const durationDays = goalWithinOnePhase ? daysNeeded : maxDurationDays;
  const projectedEndWeightKg = round2(
    currentWeightKg - (rate * durationDays) / 7,
  );

  return {
    startWeightKg: round2(currentWeightKg),
    finalGoalWeightKg,
    durationDays,
    projectedEndWeightKg,
    daysToGoal: goalWithinOnePhase ? daysNeeded : null,
    goalWithinOnePhase,
    explanation: goalWithinOnePhase
      ? `At the rate this phase achieved, ${finalGoalWeightKg} kg is about ` +
        `${Math.round(daysNeeded / 7)} weeks away — so the next phase can be ` +
        `${durationDays} days rather than a full eight weeks.`
      : `${remainingKg} kg still separates you from ${finalGoalWeightKg} kg. ` +
        `Another ${durationDays}-day phase at this rate would put you around ` +
        `${projectedEndWeightKg} kg, with the goal following in a later phase.`,
  };
}

/**
 * Recomputes the roadmap partway through a phase.
 *
 * Spec §8.5 requires milestones to move as real data arrives rather than
 * standing as a fixed ladder. The start of the phase is kept as the anchor
 * so the chart's history does not rewrite itself; only the forward rate
 * changes.
 */
export function recomputeMilestones({
  startDate,
  startWeightKg,
  durationDays,
  recommendedKgPerWeek,
  stretchTargetKg,
  trendByDate,
}: {
  startDate: IsoDate;
  startWeightKg: number;
  durationDays: number;
  recommendedKgPerWeek: number;
  stretchTargetKg: number | null;
  trendByDate?: ReadonlyMap<IsoDate, number>;
}): Milestone[] {
  return buildMilestones({
    startDate,
    startWeightKg,
    durationDays,
    recommendedKgPerWeek,
    stretchTargetKg,
    trendByDate,
  });
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

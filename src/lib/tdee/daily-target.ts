/**
 * Today's calorie and macro target.
 *
 * The phase engine (`feasibility.ts`) answers "what does this target date
 * demand"; this answers the simpler everyday question, "what should I eat
 * today given my goal and what I actually burn". A running cut phase
 * overrides it, but the app has to produce a sensible number before a phase
 * exists — and for goals that have no end date at all.
 */

import {
  type MacroTotals,
  macroTargets,
} from "@/lib/nutrition/macros";
import {
  CALORIE_FLOOR,
  KCAL_PER_KG,
  RECOMMENDED_RATE,
} from "@/lib/tdee/constants";
import { calorieFloorFor } from "@/lib/tdee/feasibility";

/** Matches the `public.goal_type` enum. */
export type GoalType = "lose" | "maintain" | "gain" | "recomp";

export type DailyTargetInput = {
  goalType: GoalType;
  weightKg: number;
  tdeeKcal: number;
  proteinGPerKg: number;
};

export type DailyTarget = {
  calories: number;
  macros: MacroTotals;
  basisTdeeKcal: number;
  /** Signed: negative is a deficit, positive a surplus. */
  energyBalanceKcal: number;
  /** True when a floor held the target above what the goal implied. */
  wasFloored: boolean;
  explanation: string;
};

/**
 * Lean-gain rate.
 *
 * Deliberately far smaller than the loss rate. Gaining faster than roughly a
 * quarter percent of bodyweight per week adds fat rather than muscle, so a
 * larger surplus would not buy what the user is after.
 */
const GAIN_RATE_PER_WEEK = 0.0025;

export function dailyTargetFor({
  goalType,
  weightKg,
  tdeeKcal,
  proteinGPerKg,
}: DailyTargetInput): DailyTarget {
  if (weightKg <= 0 || tdeeKcal <= 0) {
    throw new Error("Weight and expenditure must be positive.");
  }

  const floor = calorieFloorFor(tdeeKcal);
  let raw: number;
  let explanation: string;

  switch (goalType) {
    case "lose": {
      // The top of the recommended band, which is also what the phase
      // engine would pick for an aggressive request.
      const kgPerWeek = weightKg * RECOMMENDED_RATE.max;
      raw = tdeeKcal - (kgPerWeek * KCAL_PER_KG) / 7;
      explanation =
        `Set for about ${round1(kgPerWeek)} kg a week, the top of the ` +
        "range that reliably loses fat rather than muscle.";
      break;
    }
    case "gain": {
      const kgPerWeek = weightKg * GAIN_RATE_PER_WEEK;
      raw = tdeeKcal + (kgPerWeek * KCAL_PER_KG) / 7;
      explanation =
        "A small surplus. Gaining faster than this mostly adds fat.";
      break;
    }
    case "recomp":
      // Maintenance calories with protein doing the work.
      raw = tdeeKcal;
      explanation =
        "Maintenance calories with high protein, to change composition " +
        "rather than weight.";
      break;
    case "maintain":
      raw = tdeeKcal;
      explanation = "Set to match what you burn.";
      break;
  }

  // Round up so rounding can only ever leave more food, never less.
  const unfloored = Math.ceil(raw);
  const calories = Math.max(unfloored, floor);
  const wasFloored = calories > unfloored;

  if (wasFloored) {
    explanation =
      `Held at ${calories} kcal — the floor of ${CALORIE_FLOOR.absolute} kcal ` +
      "and 60% of what you burn, whichever is higher. A steeper deficit " +
      "would cost muscle without losing fat faster.";
  }

  return {
    calories,
    macros: macroTargets(calories, weightKg, proteinGPerKg),
    basisTdeeKcal: round1(tdeeKcal),
    energyBalanceKcal: Math.round(calories - tdeeKcal),
    wasFloored,
    explanation,
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

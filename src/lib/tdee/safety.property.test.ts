import { describe, expect, it } from "vitest";

import { MIN_FAT_SHARE, macroTargets } from "@/lib/nutrition/macros";
import {
  KCAL_PER_G_CARBS,
  KCAL_PER_G_FAT,
  KCAL_PER_G_PROTEIN,
} from "@/lib/nutrition/macros";
import { CALORIE_FLOOR, RECOMMENDED_RATE } from "@/lib/tdee/constants";
import { dailyTargetFor, type GoalType } from "@/lib/tdee/daily-target";
import { assessTarget, calorieFloorFor, recommendPlan } from "@/lib/tdee/feasibility";

/**
 * Adversarial sweeps over the safety-critical functions.
 *
 * The rest of the suite checks that the worked examples come out right. This
 * file checks the properties that must hold for *every* input, including the
 * ones nobody would type on purpose — because the spec's promise is not "the
 * examples are safe", it is that no path produces a starvation target and no
 * goal becomes an eight-week prescription.
 *
 * A grid rather than random values: a failure has to be reproducible from
 * the file alone, and a seeded generator adds nothing here when the domain
 * is small enough to enumerate.
 */

const WEIGHTS = [40, 55, 70, 90, 111.8, 150, 200, 300];
const TDEES = [1000, 1400, 1800, 2200, 2700, 3357, 4200, 6000];
const GOALS: GoalType[] = ["lose", "maintain", "gain", "recomp"];
const PROTEIN_RATES = [0.5, 1.0, 1.6, 2.2, 3.0, 4.0]; // the column's full range

describe("no path produces a starvation-level target", () => {
  it("dailyTargetFor never falls below the floor, for any goal", () => {
    const breaches: string[] = [];

    for (const weightKg of WEIGHTS) {
      for (const tdeeKcal of TDEES) {
        for (const goalType of GOALS) {
          for (const proteinGPerKg of PROTEIN_RATES) {
            const target = dailyTargetFor({
              goalType,
              weightKg,
              tdeeKcal,
              proteinGPerKg,
            });
            const floor = calorieFloorFor(tdeeKcal);
            if (target.calories < floor) {
              breaches.push(
                `${goalType} ${weightKg}kg @${tdeeKcal}: ${target.calories} < ${floor}`,
              );
            }
            if (target.calories < CALORIE_FLOOR.absolute) {
              breaches.push(
                `${goalType} ${weightKg}kg @${tdeeKcal}: below absolute floor`,
              );
            }
          }
        }
      }
    }

    expect(breaches).toEqual([]);
  });

  it("recommendPlan never falls below the floor, however brutal the ask", () => {
    const breaches: string[] = [];

    for (const weightKg of WEIGHTS) {
      for (const tdeeKcal of TDEES) {
        // Targets from "already there" to "impossible", and windows from a
        // day to a year.
        for (const targetWeightKg of [weightKg + 5, weightKg, weightKg * 0.9, weightKg * 0.5, 1]) {
          for (const days of [1, 7, 14, 56, 120, 365]) {
            const plan = recommendPlan({
              currentWeightKg: weightKg,
              targetWeightKg,
              startDate: "2026-01-01",
              targetDate: isoPlus(days),
              tdeeKcal,
            });
            const floor = calorieFloorFor(tdeeKcal);
            if (plan.recommendedCalories < floor) {
              breaches.push(
                `${weightKg}→${targetWeightKg} in ${days}d @${tdeeKcal}: ${plan.recommendedCalories} < ${floor}`,
              );
            }
          }
        }
      }
    }

    expect(breaches).toEqual([]);
  });

  it("recommendPlan never exceeds the top of the recommended rate band", () => {
    const breaches: string[] = [];

    for (const weightKg of WEIGHTS) {
      for (const tdeeKcal of TDEES) {
        for (const days of [7, 56, 365]) {
          const plan = recommendPlan({
            currentWeightKg: weightKg,
            // An impossible ask: everything the guardrail exists to refuse.
            targetWeightKg: weightKg * 0.5,
            startDate: "2026-01-01",
            targetDate: isoPlus(days),
            tdeeKcal,
          });

          // A hair of tolerance for the rounding that deliberately favours
          // more food, not less.
          if (Math.abs(plan.recommendedPctPerWeek) > RECOMMENDED_RATE.max + 1e-9) {
            breaches.push(
              `${weightKg}kg @${tdeeKcal} ${days}d: ${plan.recommendedPctPerWeek}`,
            );
          }
        }
      }
    }

    expect(breaches).toEqual([]);
  });

  it("a target below the floor is reported as unachievable, not prescribed", () => {
    // Spec 8.2's second worked example, generalised: the arithmetic says one
    // thing and the recommendation must say another.
    const assessment = assessTarget({
      currentWeightKg: 111.8,
      targetWeightKg: 90,
      startDate: "2026-01-01",
      targetDate: isoPlus(56),
      tdeeKcal: 3357,
    });

    expect(assessment.isAchievable).toBe(false);
    expect(assessment.impliedIntakeKcal).toBeLessThan(CALORIE_FLOOR.absolute);

    const plan = recommendPlan({
      currentWeightKg: 111.8,
      targetWeightKg: 90,
      startDate: "2026-01-01",
      targetDate: isoPlus(56),
      tdeeKcal: 3357,
    });

    // The 90 kg goal must not become an eight-week prescription.
    expect(plan.wasConstrained).toBe(true);
    expect(plan.recommendedCalories).toBeGreaterThanOrEqual(
      calorieFloorFor(3357),
    );
    expect(plan.projectedEndWeightKg).toBeGreaterThan(100);
    expect(plan.explanation).not.toMatch(/90 kg by/);
  });
});

describe("macro splits are internally consistent", () => {
  it("never allocates more energy than the target contains", () => {
    const breaches: string[] = [];

    for (const calories of [800, 1200, 1500, 2000, 2250, 3000, 5000]) {
      for (const weightKg of WEIGHTS) {
        for (const proteinGPerKg of PROTEIN_RATES) {
          const m = macroTargets(calories, weightKg, proteinGPerKg);
          const energy =
            m.protein_g * KCAL_PER_G_PROTEIN +
            m.carbs_g * KCAL_PER_G_CARBS +
            m.fat_g * KCAL_PER_G_FAT;

          // Rounding to whole grams of protein can only lose energy, so the
          // sum may sit a little under but never over.
          if (energy > calories + 1) {
            breaches.push(
              `${calories} kcal, ${weightKg}kg @${proteinGPerKg}g/kg: macros are ${Math.round(energy)} kcal`,
            );
          }
          if (m.protein_g < 0 || m.carbs_g < 0 || m.fat_g < 0) {
            breaches.push(`negative macro at ${calories}/${weightKg}`);
          }
        }
      }
    }

    expect(breaches).toEqual([]);
  });

  it("never pushes fat below the floor it documents", () => {
    const breaches: string[] = [];

    for (const calories of [1200, 1500, 2000, 2250, 3000]) {
      for (const weightKg of WEIGHTS) {
        for (const proteinGPerKg of PROTEIN_RATES) {
          const m = macroTargets(calories, weightKg, proteinGPerKg);
          const fatKcal = m.fat_g * KCAL_PER_G_FAT;

          // 1 kcal of slack for the gram rounding.
          if (fatKcal < calories * MIN_FAT_SHARE - 1) {
            breaches.push(
              `${calories} kcal, ${weightKg}kg @${proteinGPerKg}g/kg: fat is ${Math.round(fatKcal)} kcal, floor is ${Math.round(calories * MIN_FAT_SHARE)}`,
            );
          }
        }
      }
    }

    expect(breaches).toEqual([]);
  });

  it("caps protein rather than overrunning the budget", () => {
    // 200 kg at 4 g/kg is 800 g of protein — 3200 kcal — against a 1500 kcal
    // target. Both are values the database accepts.
    const m = macroTargets(1500, 200, 4.0);

    expect(m.protein_g * KCAL_PER_G_PROTEIN).toBeLessThanOrEqual(1500);
    expect(m.protein_g).toBeLessThan(800);
    expect(m.fat_g * KCAL_PER_G_FAT).toBeGreaterThanOrEqual(1500 * MIN_FAT_SHARE - 1);
  });
});

/** A date `days` after 2026-01-01, as an ISO day string. */
function isoPlus(days: number): `${number}-${number}-${number}` {
  const d = new Date(Date.UTC(2026, 0, 1));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10) as `${number}-${number}-${number}`;
}

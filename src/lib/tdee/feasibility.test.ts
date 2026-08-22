import { describe, expect, it } from "vitest";

import {
  assessTarget,
  calorieFloorFor,
  classifyRate,
  daysToReach,
  recommendPlan,
} from "@/lib/tdee/feasibility";

/**
 * The spec's worked examples (§8.2), encoded so the safety behaviour cannot
 * silently drift. ARCHITECTURE §8 requires exactly this.
 */
const SPEC = {
  startWeightKg: 111.8,
  startDate: "2026-08-22",
  endDate: "2026-10-17", // 56 days later
  tdeeKcal: 3357,
};

describe("classifyRate — guardrail bands (spec 8.3)", () => {
  it("classifies each band by percentage of bodyweight per week", () => {
    expect(classifyRate(0.004)).toBe("slow");
    expect(classifyRate(0.005)).toBe("typical");
    expect(classifyRate(0.0075)).toBe("typical");
    expect(classifyRate(0.01)).toBe("typical");
    expect(classifyRate(0.011)).toBe("aggressive");
    expect(classifyRate(0.0125)).toBe("aggressive");
    expect(classifyRate(0.013)).toBe("very_aggressive");
  });

  it("classifies on magnitude, so a gain rate bands the same way", () => {
    expect(classifyRate(-0.011)).toBe("aggressive");
  });
});

describe("assessTarget — 111.8 kg to 99 kg in 56 days (spec 8.2)", () => {
  const result = assessTarget({
    currentWeightKg: SPEC.startWeightKg,
    targetWeightKg: 99,
    startDate: SPEC.startDate,
    targetDate: SPEC.endDate,
    tdeeKcal: SPEC.tdeeKcal,
  });

  it("spans 56 days", () => {
    expect(result.daysRemaining).toBe(56);
    expect(result.weeksRemaining).toBe(8);
  });

  it("requires 12.8 kg", () => {
    expect(result.differenceKg).toBe(12.8);
  });

  it("requires about 1.6 kg per week", () => {
    expect(result.requiredKgPerWeek).toBeCloseTo(1.6, 2);
  });

  it("implies a deficit of about 1760 kcal/day", () => {
    // (12.8 × 7700) / 56
    expect(result.requiredDeficitKcal).toBeCloseTo(1760, 0);
  });

  it("implies an intake of about 1600 kcal at TDEE 3357", () => {
    expect(result.impliedIntakeKcal).toBeCloseTo(1597, 0);
  });

  it("classifies as very aggressive", () => {
    // 1.6 / 111.8 = 1.43% per week, above the 1.25% threshold.
    expect(result.requiredPctPerWeek).toBeCloseTo(0.0143, 4);
    expect(result.classification).toBe("very_aggressive");
  });

  it("is arithmetically possible, but below what we would recommend", () => {
    // A real number, so not dismissed as unachievable — but well under the
    // recommendation floor, which is why recommendPlan overrides it.
    expect(result.isAchievable).toBe(true);
    expect(result.impliedIntakeKcal).toBeLessThan(
      calorieFloorFor(SPEC.tdeeKcal),
    );
  });
});

describe("assessTarget — 111.8 kg to 90 kg in 56 days (spec 8.2)", () => {
  const result = assessTarget({
    currentWeightKg: SPEC.startWeightKg,
    targetWeightKg: 90,
    startDate: SPEC.startDate,
    targetDate: SPEC.endDate,
    tdeeKcal: SPEC.tdeeKcal,
  });

  it("requires 21.8 kg at about 2.7 kg per week", () => {
    expect(result.differenceKg).toBe(21.8);
    expect(result.requiredKgPerWeek).toBeCloseTo(2.725, 2);
  });

  it("implies a deficit of about 3000 kcal/day", () => {
    expect(result.requiredDeficitKcal).toBeCloseTo(2997.5, 1);
  });

  it("is not a realistic target for this timeframe", () => {
    expect(result.isAchievable).toBe(false);
    expect(result.classification).toBe("very_aggressive");
    expect(result.summary).toContain("not a realistic fat-loss target");
    expect(result.summary).toContain("long-term goal");
  });

  it("still reports the honest arithmetic rather than hiding it", () => {
    // Implied intake here is ~359 kcal — absurd, and shown as such.
    expect(result.impliedIntakeKcal).toBeLessThan(500);
  });
});

describe("recommendPlan — the guardrail overrides the arithmetic", () => {
  it("never recommends the 1600 kcal the 99 kg target implies (spec 8.2)", () => {
    const plan = recommendPlan({
      currentWeightKg: SPEC.startWeightKg,
      targetWeightKg: 99,
      startDate: SPEC.startDate,
      targetDate: SPEC.endDate,
      tdeeKcal: SPEC.tdeeKcal,
    });

    expect(plan.wasConstrained).toBe(true);
    expect(plan.recommendedCalories).toBeGreaterThan(1600);
    // 1% of 111.8 = 1.118 kg/week -> ~1230 kcal deficit -> ~2127 kcal.
    expect(plan.recommendedCalories).toBeCloseTo(2127, -1);
  });

  it("keeps the recommended rate inside the effective band", () => {
    const plan = recommendPlan({
      currentWeightKg: SPEC.startWeightKg,
      targetWeightKg: 99,
      startDate: SPEC.startDate,
      targetDate: SPEC.endDate,
      tdeeKcal: SPEC.tdeeKcal,
    });

    expect(classifyRate(plan.recommendedPctPerWeek)).toBe("typical");
    expect(plan.recommendedPctPerWeek).toBeLessThanOrEqual(0.01);
  });

  it("projects the ~103-105 kg end-of-phase range the spec states (8.1)", () => {
    const plan = recommendPlan({
      currentWeightKg: SPEC.startWeightKg,
      targetWeightKg: 99,
      startDate: SPEC.startDate,
      targetDate: SPEC.endDate,
      tdeeKcal: SPEC.tdeeKcal,
    });

    expect(plan.projectedRangeKg.low).toBeCloseTo(102.86, 1);
    expect(plan.projectedRangeKg.high).toBeCloseTo(105.09, 1);
  });

  it("explains the gap without shaming (spec 8.6)", () => {
    const plan = recommendPlan({
      currentWeightKg: SPEC.startWeightKg,
      targetWeightKg: 90,
      startDate: SPEC.startDate,
      targetDate: SPEC.endDate,
      tdeeKcal: SPEC.tdeeKcal,
    });

    expect(plan.explanation).toContain(
      "more aggressive than the recommended rate",
    );
    expect(plan.explanation).not.toMatch(/fail|lazy|should have|excuse/i);
  });

  it("honours a target that already sits inside the band", () => {
    // 5 kg over 8 weeks = 0.625 kg/week = 0.56% of bodyweight.
    const plan = recommendPlan({
      currentWeightKg: SPEC.startWeightKg,
      targetWeightKg: 106.8,
      startDate: SPEC.startDate,
      targetDate: SPEC.endDate,
      tdeeKcal: SPEC.tdeeKcal,
    });

    expect(plan.wasConstrained).toBe(false);
    expect(plan.projectedEndWeightKg).toBeCloseTo(106.8, 1);
  });

  it("recommends maintenance when the target is already met", () => {
    const plan = recommendPlan({
      currentWeightKg: 89,
      targetWeightKg: 90,
      startDate: SPEC.startDate,
      targetDate: SPEC.endDate,
      tdeeKcal: 2800,
    });

    expect(plan.recommendedKgPerWeek).toBe(0);
    expect(plan.recommendedCalories).toBe(2800);
  });

  it("never recommends below the calorie floor, even at a low TDEE", () => {
    const plan = recommendPlan({
      currentWeightKg: 60,
      targetWeightKg: 50,
      startDate: SPEC.startDate,
      targetDate: SPEC.endDate,
      tdeeKcal: 1900,
    });

    expect(plan.recommendedCalories).toBeGreaterThanOrEqual(
      calorieFloorFor(1900),
    );
    expect(plan.recommendedCalories).toBeGreaterThanOrEqual(1200);
  });
});

describe("calorieFloorFor", () => {
  it("is the greater of the absolute floor and 60% of expenditure", () => {
    expect(calorieFloorFor(3357)).toBe(2014);
    expect(calorieFloorFor(1800)).toBe(1200);
  });
});

describe("daysToReach", () => {
  it("projects when the final goal arrives at a sustainable rate", () => {
    // 111.8 -> 90 kg at 1.118 kg/week is ~137 days, not 56.
    expect(daysToReach(111.8, 90, 1.118)).toBe(137);
  });

  it("returns 0 when the goal is already met", () => {
    expect(daysToReach(89, 90, 1)).toBe(0);
  });

  it("returns null at a zero rate rather than dividing by zero", () => {
    expect(daysToReach(111.8, 90, 0)).toBeNull();
  });
});

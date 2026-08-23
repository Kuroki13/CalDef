import { describe, expect, it } from "vitest";

import { CALORIE_FLOOR } from "@/lib/tdee/constants";
import { classifyRate } from "@/lib/tdee/feasibility";
import { DEFAULT_PHASE_DAYS, planPhase } from "@/lib/tdee/phase-plan";

/** The spec's subject at the start of a phase (§8.1). */
const SPEC = {
  startDate: "2026-08-22",
  startWeightKg: 111.8,
  tdeeKcal: 3357,
  proteinGPerKg: 1.6,
  finalGoalWeightKg: 90,
  stretchTargetKg: 99,
};

describe("planPhase — the spec's worked phase (§8.1)", () => {
  const plan = planPhase(SPEC);

  it("runs 56 days", () => {
    expect(plan.durationDays).toBe(DEFAULT_PHASE_DAYS);
    expect(plan.endDate).toBe("2026-10-17");
  });

  it("recommends the ~103-105 kg end-of-phase range", () => {
    expect(plan.recommendedTargetLowKg).toBeCloseTo(102.86, 1);
    expect(plan.recommendedTargetHighKg).toBeCloseTo(105.09, 1);
  });

  it("orders the range low-to-high, as the check constraint requires", () => {
    expect(plan.recommendedTargetLowKg).toBeLessThanOrEqual(
      plan.recommendedTargetHighKg,
    );
  });

  it("keeps the stretch and final goals distinct from the recommendation", () => {
    // Spec 8.1: four separate concepts, never collapsed.
    expect(plan.stretchTargetKg).toBe(99);
    expect(plan.finalGoalWeightKg).toBe(90);
    expect(plan.recommendedTargetLowKg).toBeGreaterThan(99);
  });

  it("starts near the spec's ~2250 kcal and ~180 g protein (§8.8)", () => {
    expect(plan.initialTargetKcal).toBeGreaterThan(2050);
    expect(plan.initialTargetKcal).toBeLessThan(2300);
    expect(plan.initialProteinG).toBe(179);
  });

  it("never prescribes the stretch target's calorie figure", () => {
    // 99 kg in 56 days implies ~1597 kcal. The plan must not return that.
    expect(plan.stretchAssessment!.impliedIntakeKcal).toBeLessThan(1700);
    expect(plan.initialTargetKcal).toBeGreaterThan(2000);
  });

  it("keeps the recommended rate inside the effective band (§8.3)", () => {
    const pct = plan.recommendedKgPerWeek / plan.startWeightKg;
    expect(classifyRate(pct)).toBe("typical");
  });

  it("reproduces the spec's weekly roadmap (§8.5)", () => {
    const expected = [
      111.8, 110.7, 109.6, 108.5, 107.4, 106.3, 105.2, 104.1, 103,
    ];
    expect(plan.milestones).toHaveLength(9);
    plan.milestones.forEach((m, i) => {
      expect(m.recommendedWeightKg).toBeCloseTo(expected[i], 0);
    });
  });

  it("draws the stretch line separately, reaching 99 kg", () => {
    expect(plan.milestones[8].stretchWeightKg).toBeCloseTo(99, 1);
  });
});

describe("planPhase — honesty about the stretch target", () => {
  const plan = planPhase(SPEC);

  it("reports what the stretch target actually demands", () => {
    const s = plan.stretchAssessment!;
    expect(s.differenceKg).toBe(12.8);
    expect(s.requiredKgPerWeek).toBeCloseTo(1.6, 2);
    expect(s.classification).toBe("very_aggressive");
  });

  it("reports the final goal as unrealistic for this window (§8.2)", () => {
    const f = plan.finalGoalAssessment!;
    expect(f.isAchievable).toBe(false);
    expect(f.summary).toContain("not a realistic fat-loss target");
  });

  it("says the phase is a step toward the goal, not an attempt at it", () => {
    expect(plan.explanation).toContain("long-term goal");
    expect(plan.explanation).toContain("step toward it");
  });

  it("uses no shaming language (§8.6)", () => {
    expect(plan.explanation).not.toMatch(/fail|lazy|should have|excuse|only/i);
  });
});

describe("planPhase — a target already inside the band", () => {
  const plan = planPhase({ ...SPEC, stretchTargetKg: 106.8 });

  it("honours it rather than overriding", () => {
    expect(plan.plan.wasConstrained).toBe(false);
    expect(plan.milestones[8].recommendedWeightKg).toBeCloseTo(106.8, 0);
  });
});

describe("planPhase — floors and guards", () => {
  it("never starts a phase below the calorie floor", () => {
    const plan = planPhase({
      ...SPEC,
      startWeightKg: 60,
      tdeeKcal: 1900,
      stretchTargetKg: 50,
    });
    expect(plan.initialTargetKcal).toBeGreaterThanOrEqual(
      CALORIE_FLOOR.absolute,
    );
  });

  it("stays inside the daily_targets check constraint across a wide range", () => {
    for (const startWeightKg of [45, 111.8, 250]) {
      for (const tdeeKcal of [1500, 3357, 5500]) {
        const plan = planPhase({ ...SPEC, startWeightKg, tdeeKcal });
        expect(plan.initialTargetKcal).toBeGreaterThanOrEqual(800);
        expect(plan.initialTargetKcal).toBeLessThanOrEqual(10000);
      }
    }
  });

  it("copes with no stretch and no final goal", () => {
    const plan = planPhase({
      ...SPEC,
      stretchTargetKg: null,
      finalGoalWeightKg: null,
    });
    expect(plan.stretchAssessment).toBeNull();
    expect(plan.finalGoalAssessment).toBeNull();
    expect(plan.milestones[0].stretchWeightKg).toBeNull();
  });

  it("rejects nonsensical inputs rather than producing a phase", () => {
    expect(() => planPhase({ ...SPEC, startWeightKg: 0 })).toThrow();
    expect(() => planPhase({ ...SPEC, tdeeKcal: 0 })).toThrow();
    expect(() => planPhase({ ...SPEC, durationDays: 3 })).toThrow();
  });
});

import { describe, expect, it } from "vitest";

import { kcalFromMacros } from "@/lib/nutrition/macros";
import { dailyTargetFor } from "@/lib/tdee/daily-target";

/** The spec's starting subject (§6). */
const SUBJECT = {
  weightKg: 111.8,
  tdeeKcal: 3357,
  proteinGPerKg: 1.6,
} as const;

describe("dailyTargetFor — losing", () => {
  const target = dailyTargetFor({ ...SUBJECT, goalType: "lose" });

  it("lands near the spec's ~2250 kcal starting target (spec 8.8)", () => {
    // 1% of 111.8 = 1.118 kg/week -> ~1230 kcal/day deficit.
    expect(target.calories).toBeGreaterThan(2050);
    expect(target.calories).toBeLessThan(2300);
  });

  it("reports a deficit, not a surplus", () => {
    expect(target.energyBalanceKcal).toBeLessThan(0);
  });

  it("hits the spec's ~180 g protein", () => {
    expect(target.macros.protein_g).toBe(179);
  });

  it("produces macros that add back up to the calorie target", () => {
    expect(kcalFromMacros(target.macros)).toBeCloseTo(target.calories, 0);
  });

  it("is not floored for this subject", () => {
    expect(target.wasFloored).toBe(false);
  });
});

describe("dailyTargetFor — the floor", () => {
  it("holds a light subject above the floor rather than obeying the rate", () => {
    // 1%/week of 55 kg is only ~605 kcal of deficit, so the floor should not
    // bite here...
    const light = dailyTargetFor({
      goalType: "lose",
      weightKg: 55,
      tdeeKcal: 1900,
      proteinGPerKg: 1.6,
    });
    expect(light.calories).toBeGreaterThanOrEqual(1200);
  });

  it("never returns below the absolute floor", () => {
    const extreme = dailyTargetFor({
      goalType: "lose",
      weightKg: 200,
      tdeeKcal: 1900,
      proteinGPerKg: 1.6,
    });
    expect(extreme.calories).toBeGreaterThanOrEqual(1200);
    expect(extreme.wasFloored).toBe(true);
    expect(extreme.explanation).toContain("floor");
  });

  it("never returns below 60% of expenditure", () => {
    const target = dailyTargetFor({
      goalType: "lose",
      weightKg: 200,
      tdeeKcal: 4000,
      proteinGPerKg: 1.6,
    });
    expect(target.calories).toBeGreaterThanOrEqual(2400);
  });
});

describe("dailyTargetFor — other goals", () => {
  it("matches expenditure when maintaining", () => {
    const target = dailyTargetFor({ ...SUBJECT, goalType: "maintain" });
    expect(target.calories).toBe(3357);
    expect(target.energyBalanceKcal).toBe(0);
  });

  it("matches expenditure when recomping, with protein doing the work", () => {
    const target = dailyTargetFor({ ...SUBJECT, goalType: "recomp" });
    expect(target.calories).toBe(3357);
    expect(target.explanation).toContain("composition");
  });

  it("adds only a small surplus when gaining", () => {
    const target = dailyTargetFor({ ...SUBJECT, goalType: "gain" });
    expect(target.energyBalanceKcal).toBeGreaterThan(0);
    // 0.25%/week of 111.8 kg is ~0.28 kg -> ~307 kcal/day.
    expect(target.energyBalanceKcal).toBeLessThan(400);
  });
});

describe("dailyTargetFor — guards", () => {
  it("rejects a non-positive weight or expenditure", () => {
    expect(() =>
      dailyTargetFor({ ...SUBJECT, weightKg: 0, goalType: "lose" }),
    ).toThrow();
    expect(() =>
      dailyTargetFor({ ...SUBJECT, tdeeKcal: 0, goalType: "lose" }),
    ).toThrow();
  });

  it("stays inside the daily_targets check constraint (800-10000)", () => {
    for (const weightKg of [40, 111.8, 300]) {
      for (const tdeeKcal of [1400, 3357, 6000]) {
        const target = dailyTargetFor({
          goalType: "lose",
          weightKg,
          tdeeKcal,
          proteinGPerKg: 1.6,
        });
        expect(target.calories).toBeGreaterThanOrEqual(800);
        expect(target.calories).toBeLessThanOrEqual(10000);
      }
    }
  });
});

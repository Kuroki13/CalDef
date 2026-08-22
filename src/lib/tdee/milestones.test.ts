import { describe, expect, it } from "vitest";

import {
  buildMilestones,
  isCheckpointDay,
  phaseProgress,
} from "@/lib/tdee/milestones";

const START = "2026-08-22";

describe("buildMilestones — the spec's roadmap (8.5)", () => {
  const milestones = buildMilestones({
    startDate: START,
    startWeightKg: 111.8,
    durationDays: 56,
  });

  it("produces week 0 through week 8", () => {
    expect(milestones).toHaveLength(9);
    expect(milestones[0].weekNumber).toBe(0);
    expect(milestones[8].weekNumber).toBe(8);
  });

  it("starts at the starting weight", () => {
    expect(milestones[0].recommendedWeightKg).toBe(111.8);
  });

  it("reproduces the illustrative roadmap", () => {
    // START 111.8 · W1 ~110.7 · W2 ~109.6 · W3 ~108.5 · W4 ~107.4
    // W5 ~106.3 · W6 ~105.2 · W7 ~104.1 · W8 ~103
    const expected = [111.8, 110.7, 109.6, 108.5, 107.4, 106.3, 105.2, 104.1, 103];
    milestones.forEach((m, i) => {
      expect(m.recommendedWeightKg).toBeCloseTo(expected[i], 0);
    });
  });

  it("lands in the recommended end-of-phase range (spec 8.1)", () => {
    const final = milestones[8].recommendedWeightKg;
    expect(final).toBeGreaterThan(102);
    expect(final).toBeLessThan(105.5);
  });

  it("spaces milestones seven days apart", () => {
    expect(milestones[1].date).toBe("2026-08-29");
    expect(milestones[8].date).toBe("2026-10-17");
  });

  it("is not a flat kilogram per week", () => {
    // The rate is a share of bodyweight, so it is 1.118 kg/week here — the
    // spec is explicit that a flat 1 kg subtraction is wrong.
    const step = milestones[0].recommendedWeightKg - milestones[1].recommendedWeightKg;
    expect(step).toBeCloseTo(1.118, 2);
    expect(step).not.toBeCloseTo(1.0, 2);
  });
});

describe("buildMilestones — the stretch path", () => {
  const milestones = buildMilestones({
    startDate: START,
    startWeightKg: 111.8,
    durationDays: 56,
    stretchTargetKg: 99,
  });

  it("reaches the stretch target in the final week", () => {
    expect(milestones[8].stretchWeightKg).toBeCloseTo(99, 1);
  });

  it("stays below the recommended path throughout", () => {
    for (const m of milestones.slice(1)) {
      expect(m.stretchWeightKg!).toBeLessThan(m.recommendedWeightKg);
    }
  });

  it("is null when no stretch target is set", () => {
    const plain = buildMilestones({
      startDate: START,
      startWeightKg: 111.8,
      durationDays: 56,
    });
    expect(plain[4].stretchWeightKg).toBeNull();
  });
});

describe("buildMilestones — recomputation from real data", () => {
  it("uses an adaptive rate when one is supplied", () => {
    const milestones = buildMilestones({
      startDate: START,
      startWeightKg: 111.8,
      durationDays: 56,
      recommendedKgPerWeek: 0.9,
    });
    expect(milestones[8].recommendedWeightKg).toBeCloseTo(111.8 - 7.2, 1);
  });

  it("takes a rate's magnitude, so a signed rate works either way", () => {
    const negative = buildMilestones({
      startDate: START,
      startWeightKg: 111.8,
      durationDays: 56,
      recommendedKgPerWeek: -0.9,
    });
    expect(negative[8].recommendedWeightKg).toBeCloseTo(104.6, 1);
  });

  it("backfills the actual trend for weeks already elapsed", () => {
    const trend = new Map([
      [START, 111.8],
      ["2026-08-29", 110.9],
    ]);
    const milestones = buildMilestones({
      startDate: START,
      startWeightKg: 111.8,
      durationDays: 56,
      trendByDate: trend,
    });

    expect(milestones[0].actualTrendWeightKg).toBe(111.8);
    expect(milestones[1].actualTrendWeightKg).toBe(110.9);
    expect(milestones[2].actualTrendWeightKg).toBeNull();
  });
});

describe("phaseProgress", () => {
  it("reports day 1 on the start date", () => {
    const p = phaseProgress(START, 56, START);
    expect(p.dayNumber).toBe(1);
    expect(p.daysRemaining).toBe(56);
    expect(p.isComplete).toBe(false);
  });

  it("reports the halfway checkpoint", () => {
    const p = phaseProgress(START, 56, "2026-09-18"); // day 28
    expect(p.dayNumber).toBe(28);
    expect(p.fractionComplete).toBeCloseTo(0.482, 2);
  });

  it("completes on the final day", () => {
    const p = phaseProgress(START, 56, "2026-10-17");
    expect(p.isComplete).toBe(true);
    expect(p.daysRemaining).toBe(0);
    expect(p.fractionComplete).toBe(1);
  });

  it("clamps past the end rather than reporting day 70 of 56", () => {
    const p = phaseProgress(START, 56, "2026-11-30");
    expect(p.dayNumber).toBe(56);
    expect(p.daysRemaining).toBe(0);
    expect(p.fractionComplete).toBe(1);
  });
});

describe("isCheckpointDay (spec 8.10)", () => {
  it("recognises the six checkpoints", () => {
    for (const day of [1, 7, 14, 28, 42, 56]) {
      expect(isCheckpointDay(day)).toBe(true);
    }
  });

  it("rejects other days", () => {
    expect(isCheckpointDay(2)).toBe(false);
    expect(isCheckpointDay(30)).toBe(false);
  });
});

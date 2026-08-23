import { describe, expect, it } from "vitest";

import {
  bestLoggedStreak,
  buildPhaseReport,
  checkpointKind,
  checkpointsFor,
  type PhaseReportInput,
} from "@/lib/tdee/checkpoints";
import { proposePhaseTwo } from "@/lib/tdee/phase-plan";

const START = "2026-08-02";

describe("checkpointsFor — the spec's schedule (§8.10)", () => {
  const points = checkpointsFor(START, 56, "2026-08-23");

  it("uses days 1, 7, 14, 28, 42 and 56", () => {
    expect(points.map((p) => p.day)).toEqual([1, 7, 14, 28, 42, 56]);
  });

  it("dates them from the phase start", () => {
    expect(points[0].date).toBe("2026-08-02");
    expect(points[5].date).toBe("2026-09-26");
  });

  it("marks day 28 as halfway and day 56 as final", () => {
    expect(points.find((p) => p.day === 28)?.kind).toBe("halfway");
    expect(points.find((p) => p.day === 56)?.kind).toBe("final");
    expect(points.find((p) => p.day === 1)?.kind).toBe("baseline");
  });

  it("marks only the checkpoints already reached", () => {
    // 2026-08-23 is day 22 of the phase.
    expect(points.filter((p) => p.reached).map((p) => p.day)).toEqual([1, 7, 14]);
  });

  it("keeps the same shape for a phase of another length", () => {
    const short = checkpointsFor(START, 28, "2026-08-02");
    expect(short[0].day).toBe(1);
    expect(short[short.length - 1].day).toBe(28);
    expect(short.some((p) => p.kind === "halfway")).toBe(true);
    // No checkpoint may fall past the end of the phase.
    expect(short.every((p) => p.day <= 28)).toBe(true);
  });
});

describe("checkpointKind", () => {
  it("classifies the boundaries", () => {
    expect(checkpointKind(1, 56)).toBe("baseline");
    expect(checkpointKind(28, 56)).toBe("halfway");
    expect(checkpointKind(56, 56)).toBe("final");
    expect(checkpointKind(14, 56)).toBe("progress");
  });

  it("treats a day past the end as final rather than progress", () => {
    expect(checkpointKind(70, 56)).toBe("final");
  });
});

describe("bestLoggedStreak", () => {
  it("is zero with nothing logged", () => {
    expect(bestLoggedStreak([])).toBe(0);
  });

  it("counts a consecutive run", () => {
    expect(
      bestLoggedStreak(["2026-08-01", "2026-08-02", "2026-08-03"]),
    ).toBe(3);
  });

  it("breaks the run on a gap", () => {
    // Seven days scattered across a fortnight is not a streak.
    expect(
      bestLoggedStreak([
        "2026-08-01",
        "2026-08-02",
        "2026-08-05",
        "2026-08-06",
        "2026-08-07",
        "2026-08-08",
      ]),
    ).toBe(4);
  });

  it("ignores duplicates and order", () => {
    expect(
      bestLoggedStreak(["2026-08-03", "2026-08-01", "2026-08-02", "2026-08-02"]),
    ).toBe(3);
  });

  it("crosses a month boundary", () => {
    expect(bestLoggedStreak(["2026-08-31", "2026-09-01"])).toBe(2);
  });
});

const report = (over: Partial<PhaseReportInput> = {}) =>
  buildPhaseReport({
    kind: "halfway",
    dayNumber: 29,
    totalDays: 56,
    startWeightKg: 111.8,
    currentTrendKg: 107.5,
    projectedEndWeightKg: 103.4,
    recommendedLowKg: 102.9,
    recommendedHighKg: 105.1,
    stretchTargetKg: 99,
    finalGoalWeightKg: 90,
    meanIntakeKcal: 2180,
    meanProteinG: 176,
    estimatedTdeeKcal: 3200,
    trendKgPerWeek: -1.02,
    bestStreakDays: 19,
    loggedDays: 27,
    ...over,
  });

describe("buildPhaseReport — halfway (§8.10)", () => {
  const r = report();

  it("reports the weight change on the trend", () => {
    expect(r.lostKg).toBeCloseTo(4.3, 2);
    expect(r.body[0]).toContain("111.8");
    expect(r.body[0]).toContain("107.5");
    expect(r.body[0]).toContain("down 4.3 kg");
  });

  it("reports the average weekly loss", () => {
    expect(r.averageWeeklyLossKg).toBeCloseTo(1.075, 2);
  });

  it("reports intake, protein, expenditure and adherence", () => {
    const text = r.body.join(" ");
    expect(text).toContain("2180 kcal");
    expect(text).toContain("176 g");
    expect(text).toContain("3200 kcal");
    expect(text).toContain("best unbroken run was 19 days");
  });

  it("attributes the average to the days actually logged", () => {
    // Quoting an average over elapsed days would tell someone who logged 27
    // of 56 days that they ate half what they ate.
    expect(r.body.join(" ")).toContain("Across the 27 days you logged");
  });

  it("says nothing about intake when nothing was logged", () => {
    const none = report({ loggedDays: 0, meanIntakeKcal: 0, meanProteinG: 0 });
    expect(none.body.join(" ")).toContain("No food was logged");
    expect(none.body.join(" ")).not.toContain("averaged 0 kcal");
  });

  it("projects the end of the phase against the recommended range", () => {
    expect(r.body.join(" ")).toContain("103.4");
    expect(r.body.join(" ")).toContain("102.9–105.1");
  });

  it("states the stretch gap without shaming (§8.6)", () => {
    const text = r.body.join(" ");
    expect(text).toContain("stays on the chart as a marker");
    expect(text).not.toMatch(/fail|lazy|should have|excuse|disappoint/i);
  });

  it("acknowledges a stretch target that is being met", () => {
    const ahead = report({ projectedEndWeightKg: 98 });
    expect(ahead.body.join(" ")).toContain("at or past your 99 kg stretch");
  });
});

describe("buildPhaseReport — final (§8.10)", () => {
  const r = report({ kind: "final", dayNumber: 57, totalDays: 56 });

  it("adds percentage of bodyweight lost", () => {
    expect(r.percentBodyweightLost).toBeCloseTo(3.85, 1);
    expect(r.body[0]).toContain("% of your starting bodyweight");
  });

  it("keeps the long-term goal in view", () => {
    expect(r.body.join(" ")).toContain("90 kg remains the long-term goal");
  });

  it("does not project a phase that has finished", () => {
    expect(r.body.join(" ")).not.toContain("on course for");
  });
});

describe("buildPhaseReport — thin data and gains", () => {
  it("says so rather than inventing a summary", () => {
    const r = report({ currentTrendKg: null });
    expect(r.body[0]).toContain("not enough weigh-ins");
    expect(r.lostKg).toBeNull();
  });

  it("describes a gain neutrally", () => {
    const r = report({ currentTrendKg: 113 });
    expect(r.body[0]).toContain("up 1.2 kg");
    expect(r.body.join(" ")).not.toMatch(/fail|bad|worse/i);
  });

  it("describes no movement as level", () => {
    expect(report({ currentTrendKg: 111.8 }).body[0]).toContain("level so far");
  });
});

describe("proposePhaseTwo (§8.10)", () => {
  it("shortens the next phase when the goal is within reach", () => {
    const p = proposePhaseTwo({
      currentWeightKg: 96,
      finalGoalWeightKg: 90,
      observedKgPerWeek: 1,
    });
    expect(p.goalWithinOnePhase).toBe(true);
    expect(p.durationDays).toBe(42);
    expect(p.explanation).toContain("rather than a full eight weeks");
  });

  it("caps at eight weeks and says how far that gets when it does not", () => {
    const p = proposePhaseTwo({
      currentWeightKg: 103,
      finalGoalWeightKg: 90,
      observedKgPerWeek: 0.9,
    });
    expect(p.goalWithinOnePhase).toBe(false);
    expect(p.durationDays).toBe(56);
    expect(p.projectedEndWeightKg).toBeCloseTo(95.8, 1);
    expect(p.explanation).toContain("following in a later phase");
  });

  it("falls back to the band when the last phase produced no usable rate", () => {
    const p = proposePhaseTwo({
      currentWeightKg: 103,
      finalGoalWeightKg: 90,
      observedKgPerWeek: 0,
    });
    expect(p.projectedEndWeightKg).toBeLessThan(103);
  });

  it("suggests maintenance once the goal is met", () => {
    const p = proposePhaseTwo({
      currentWeightKg: 89,
      finalGoalWeightKg: 90,
      observedKgPerWeek: 1,
    });
    expect(p.explanation).toContain("maintenance phase");
  });
});

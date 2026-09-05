import { describe, expect, it } from "vitest";

import {
  buildPhaseSeries,
  dayIndexFor,
  seriesBounds,
} from "@/lib/tdee/phase-series";
import { weightTrend } from "@/lib/tdee/trend";

const START = "2026-08-23";

const base = {
  startDate: START,
  durationDays: 56,
  startWeightKg: 111.8,
  recommendedKgPerWeek: 1.118,
  stretchTargetKg: 99,
  trend: [],
};

describe("buildPhaseSeries", () => {
  const series = buildPhaseSeries(base);

  it("covers exactly the days the phase covers", () => {
    // `phaseCoversDate` treats end_date as exclusive, so a 56-day phase is
    // day 1 (the start date) through day 56. It previously ran to day 57,
    // which is end_date — the morning after — on a chart captioned
    // "day 1 to day 56".
    expect(series).toHaveLength(56);
    expect(series[0].day).toBe(1);
    expect(series[0].date).toBe(START);
    expect(series[55].day).toBe(56);
    expect(series[55].date).toBe("2026-10-17");
  });

  it("starts every projection at the starting weight", () => {
    expect(series[0].recommendedKg).toBe(111.8);
    expect(series[0].stretchKg).toBe(111.8);
  });

  it("lands the recommended line near 103 kg (spec 8.5)", () => {
    expect(series[55].recommendedKg).toBeCloseTo(103, 0);
  });

  it("lands the stretch line exactly on the stretch target, on the last day", () => {
    expect(series[55].stretchKg).toBeCloseTo(99, 2);
  });

  it("keeps the stretch line below the recommended line throughout", () => {
    // They must read as two distinct trajectories, not one thick line.
    for (const p of series.slice(1)) {
      expect(p.stretchKg!).toBeLessThan(p.recommendedKg);
    }
  });

  it("omits the stretch line when no stretch target is set", () => {
    const plain = buildPhaseSeries({ ...base, stretchTargetKg: null });
    expect(plain.every((p) => p.stretchKg === null)).toBe(true);
  });

  it("takes the rate's magnitude, so a signed rate works either way", () => {
    const negative = buildPhaseSeries({ ...base, recommendedKgPerWeek: -1.118 });
    expect(negative[55].recommendedKg).toBeCloseTo(103, 0);
  });
});

describe("buildPhaseSeries — actual and trend", () => {
  const trend = weightTrend([
    { entry_date: "2026-08-23", weight_kg: 111.8 },
    { entry_date: "2026-08-25", weight_kg: 111.2 },
  ]);
  const series = buildPhaseSeries({ ...base, trend });

  it("fills the days that carry data", () => {
    expect(series[0].actualKg).toBe(111.8);
    expect(series[2].actualKg).toBe(111.2);
    expect(series[0].trendKg).not.toBeNull();
  });

  it("leaves actual null on a day with no weigh-in", () => {
    expect(series[1].actualKg).toBeNull();
    // The trend is still defined on that day, since it is smoothed daily.
    expect(series[1].trendKg).not.toBeNull();
  });

  it("leaves both null for days that have not happened", () => {
    // Drawing a trend into the future would present a projection as a
    // measurement.
    expect(series[30].actualKg).toBeNull();
    expect(series[30].trendKg).toBeNull();
    // The projections, being projections, are still drawn.
    expect(series[30].recommendedKg).toBeGreaterThan(0);
  });
});

describe("seriesBounds", () => {
  it("spans every series it is given", () => {
    const { min, max } = seriesBounds(buildPhaseSeries(base));
    expect(min).toBeLessThan(99);
    expect(max).toBeGreaterThan(111.8);
  });

  it("stretches to include a goal marker below the data", () => {
    const withGoal = seriesBounds(buildPhaseSeries(base), [90]);
    expect(withGoal.min).toBeLessThan(90);
  });

  it("never produces a zero-height range", () => {
    const flat = buildPhaseSeries({
      ...base,
      recommendedKgPerWeek: 0,
      stretchTargetKg: null,
    });
    const { min, max } = seriesBounds(flat);
    expect(max).toBeGreaterThan(min);
  });

  it("copes with no points at all", () => {
    const { min, max } = seriesBounds([]);
    expect(max).toBeGreaterThan(min);
  });
});

describe("dayIndexFor", () => {
  it("is zero on the start date", () => {
    expect(dayIndexFor(START, 56, START)).toBe(0);
  });

  it("counts elapsed days", () => {
    expect(dayIndexFor(START, 56, "2026-09-01")).toBe(9);
  });

  it("clamps before the start and after the end", () => {
    expect(dayIndexFor(START, 56, "2026-08-01")).toBe(0);
    // Clamped to the last plotted point, which is index 55 (day 56).
    expect(dayIndexFor(START, 56, "2027-01-01")).toBe(55);
  });
});

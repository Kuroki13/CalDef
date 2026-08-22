import { describe, expect, it } from "vitest";

import {
  type WeightEntry,
  latestTrendKg,
  projectWeightKg,
  trendChangeKgPerWeek,
  weightTrend,
  windowOfDays,
} from "@/lib/tdee/trend";

const entries = (...pairs: [string, number][]): WeightEntry[] =>
  pairs.map(([entry_date, weight_kg]) => ({ entry_date, weight_kg }));

describe("weightTrend", () => {
  it("returns nothing for no entries", () => {
    expect(weightTrend([])).toEqual([]);
  });

  it("seeds on the first reading rather than warming up from zero", () => {
    const points = weightTrend(entries(["2026-08-01", 111.8]));
    expect(points).toHaveLength(1);
    expect(points[0].trendKg).toBe(111.8);
  });

  it("fills every day in the span, including days with no weigh-in", () => {
    const points = weightTrend(
      entries(["2026-08-01", 111.8], ["2026-08-05", 111.0]),
    );
    expect(points).toHaveLength(5);
    expect(points.map((p) => p.date)).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
    ]);
    expect(points[1].actualKg).toBeNull();
  });

  it("holds the trend flat on days with no reading rather than interpolating", () => {
    const points = weightTrend(
      entries(["2026-08-01", 111.8], ["2026-08-05", 111.0]),
    );
    expect(points[1].trendKg).toBe(111.8);
    expect(points[3].trendKg).toBe(111.8);
    expect(points[4].trendKg).toBeLessThan(111.8);
  });

  it("barely moves for a single anomalous weigh-in", () => {
    // A 2 kg jump from salt and carbohydrates the night before.
    const steady = entries(
      ["2026-08-01", 111.8],
      ["2026-08-02", 111.7],
      ["2026-08-03", 113.8],
      ["2026-08-04", 111.6],
    );
    const points = weightTrend(steady);
    const final = points[points.length - 1].trendKg;

    // The raw series ends 0.2 kg below where it started; the trend must not
    // have chased the spike.
    expect(final).toBeGreaterThan(111.5);
    expect(final).toBeLessThan(112.1);
  });

  it("sorts unordered input", () => {
    const points = weightTrend(
      entries(["2026-08-05", 111.0], ["2026-08-01", 111.8]),
    );
    expect(points[0].date).toBe("2026-08-01");
  });

  it("converges on a sustained level", () => {
    const points = weightTrend(
      Array.from({ length: 30 }, (_, i) => ({
        entry_date: `2026-08-${String(i + 1).padStart(2, "0")}`,
        weight_kg: 100,
      })),
    );
    expect(latestTrendKg(points)).toBe(100);
  });

  it("lags a step change instead of jumping to it", () => {
    // Ten days at 112, then ten at 108. After ten days at the new level the
    // trend has covered most of the step but is still visibly short of it —
    // which is the whole point of smoothing.
    const points = weightTrend(
      Array.from({ length: 20 }, (_, i) => ({
        entry_date: `2026-08-${String(i + 1).padStart(2, "0")}`,
        weight_kg: i < 10 ? 112 : 108,
      })),
    );
    const final = latestTrendKg(points)!;
    expect(final).toBeLessThan(112);
    expect(final).toBeGreaterThan(109);
    // Still more than a kilogram away from the new level.
    expect(final - 108).toBeGreaterThan(1);
  });
});

describe("trendChangeKgPerWeek", () => {
  it("returns null without at least two points", () => {
    expect(trendChangeKgPerWeek([])).toBeNull();
    expect(trendChangeKgPerWeek(weightTrend(entries(["2026-08-01", 111.8])))).toBeNull();
  });

  it("is negative while losing", () => {
    const points = weightTrend(
      Array.from({ length: 29 }, (_, i) => ({
        entry_date: `2026-08-${String(i + 1).padStart(2, "0")}`,
        weight_kg: 111.8 - i * 0.15,
      })),
    );
    const rate = trendChangeKgPerWeek(points);
    expect(rate).not.toBeNull();
    expect(rate!).toBeLessThan(0);
  });

  it("is zero on a flat series", () => {
    const points = weightTrend(
      Array.from({ length: 14 }, (_, i) => ({
        entry_date: `2026-08-${String(i + 1).padStart(2, "0")}`,
        weight_kg: 100,
      })),
    );
    expect(trendChangeKgPerWeek(points)).toBe(0);
  });
});

describe("windowOfDays", () => {
  const points = weightTrend(
    Array.from({ length: 28 }, (_, i) => ({
      entry_date: `2026-08-${String(i + 1).padStart(2, "0")}`,
      weight_kg: 111.8 - i * 0.1,
    })),
  );

  it("takes the trailing window", () => {
    const w = windowOfDays(points, 7);
    expect(w).toHaveLength(7);
    expect(w[w.length - 1].date).toBe("2026-08-28");
  });

  it("returns everything when the window exceeds the data", () => {
    expect(windowOfDays(points, 500)).toHaveLength(28);
  });

  it("returns nothing for a non-positive window", () => {
    expect(windowOfDays(points, 0)).toEqual([]);
  });
});

describe("projectWeightKg", () => {
  it("projects forward at the current rate (spec 8.6)", () => {
    // -0.9 kg/week for 28 days is -3.6 kg.
    expect(projectWeightKg(108, -0.9, 28)).toBe(104.4);
  });

  it("returns the current weight for a zero horizon", () => {
    expect(projectWeightKg(108, -0.9, 0)).toBe(108);
  });
});

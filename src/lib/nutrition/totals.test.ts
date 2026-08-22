import { describe, expect, it } from "vitest";

import {
  type LoggedEntry,
  loggedDayRatio,
  meanDailyIntake,
  remainingAgainstTarget,
  totalsForDay,
} from "@/lib/nutrition/totals";

const entry = (
  meal_type_id: number,
  kcal: number,
  protein_g = 0,
): LoggedEntry => ({
  meal_type_id,
  kcal,
  protein_g,
  carbs_g: 0,
  fat_g: 0,
});

describe("totalsForDay", () => {
  it("totals an empty day to zero", () => {
    const day = totalsForDay([]);
    expect(day.totals.kcal).toBe(0);
    expect(day.byMeal).toEqual([]);
    expect(day.entryCount).toBe(0);
  });

  it("sums every entry", () => {
    const day = totalsForDay([entry(1, 330, 62), entry(2, 195, 4)]);
    expect(day.totals.kcal).toBe(525);
    expect(day.totals.protein_g).toBe(66);
    expect(day.entryCount).toBe(2);
  });

  it("groups by meal", () => {
    const day = totalsForDay([
      entry(1, 300),
      entry(1, 200),
      entry(2, 450),
    ]);

    expect(day.byMeal).toHaveLength(2);
    const breakfast = day.byMeal.find((m) => m.meal_type_id === 1);
    expect(breakfast?.totals.kcal).toBe(500);
    expect(breakfast?.entryCount).toBe(2);
  });

  it("keeps meals in first-seen order", () => {
    const day = totalsForDay([entry(3, 100), entry(1, 100), entry(3, 100)]);
    expect(day.byMeal.map((m) => m.meal_type_id)).toEqual([3, 1]);
  });
});

describe("remainingAgainstTarget", () => {
  const target = { kcal: 2250, protein_g: 180, carbs_g: 200, fat_g: 70 };

  it("reports what is left", () => {
    const r = remainingAgainstTarget(
      { kcal: 1500, protein_g: 120, carbs_g: 140, fat_g: 45 },
      target,
    );
    expect(r.kcal).toBe(750);
    expect(r.protein_g).toBe(60);
    expect(r.isOver).toBe(false);
    expect(r.kcalProgress).toBeCloseTo(0.667, 2);
  });

  it("goes negative when over target", () => {
    const r = remainingAgainstTarget(
      { kcal: 2500, protein_g: 200, carbs_g: 220, fat_g: 80 },
      target,
    );
    expect(r.kcal).toBe(-250);
    expect(r.isOver).toBe(true);
  });

  it("clamps progress so a runaway day still renders", () => {
    const r = remainingAgainstTarget(
      { kcal: 99999, protein_g: 0, carbs_g: 0, fat_g: 0 },
      target,
    );
    expect(r.kcalProgress).toBe(2);
  });

  it("does not divide by a zero target", () => {
    const r = remainingAgainstTarget(
      { kcal: 100, protein_g: 0, carbs_g: 0, fat_g: 0 },
      { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
    );
    expect(r.kcalProgress).toBe(0);
  });
});

describe("meanDailyIntake", () => {
  const day = (kcal: number) => ({
    kcal,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
  });

  it("averages across elapsed days, not across logged days", () => {
    // Three logged days totalling 6000 kcal, but seven days elapsed.
    // Dividing by 3 would report 2000 and inflate the expenditure estimate.
    const mean = meanDailyIntake([day(2000), day(2000), day(2000)], 7);
    expect(mean.kcal).toBeCloseTo(857.14, 1);
  });

  it("returns zero for a zero-day span", () => {
    expect(meanDailyIntake([day(2000)], 0).kcal).toBe(0);
  });
});

describe("loggedDayRatio", () => {
  it("reports adherence as a fraction", () => {
    expect(loggedDayRatio(5, 7)).toBeCloseTo(0.714, 3);
    expect(loggedDayRatio(7, 7)).toBe(1);
  });

  it("clamps and guards against a zero span", () => {
    expect(loggedDayRatio(9, 7)).toBe(1);
    expect(loggedDayRatio(1, 0)).toBe(0);
  });
});

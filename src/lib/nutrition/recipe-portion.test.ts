import { describe, expect, it } from "vitest";

import { recipePortion } from "@/lib/nutrition/recipe-portion";

// Mom's chicken maqlouba: 600 g chicken + 500 g rice raw, 6 servings,
// 2437 kcal in all; the finished pot weighed 2400 g.
const maqlouba = {
  perServing: { kcal: 406.17, protein_g: 28, carbs_g: 66, fat_g: 4 },
  servings: 6,
  rawGrams: 1100,
  cookedWeightG: 2400,
};

describe("recipePortion", () => {
  it("logs servings as servings, weighing them by the cooked dish", () => {
    const result = recipePortion(maqlouba, { amount: 1.5, unit: "serving" });
    if ("error" in result) throw new Error(result.error);
    expect(result.servingsEaten).toBe(1.5);
    expect(result.grams).toBe(600); // 1.5 × 2400 / 6
    expect(result.macros.kcal).toBeCloseTo(609.26, 1);
  });

  it("logs 450 g as a fraction of the weighed pot (the spec's case)", () => {
    const result = recipePortion(maqlouba, { amount: 450, unit: "g" });
    if ("error" in result) throw new Error(result.error);
    expect(result.servingsEaten).toBeCloseTo(1.125);
    expect(result.grams).toBe(450);
    expect(result.macros.kcal).toBeCloseTo(456.94, 1);
  });

  it("refuses grams when the dish was never weighed, instead of guessing from raw weights", () => {
    const result = recipePortion({ ...maqlouba, cookedWeightG: null }, { amount: 450, unit: "g" });
    expect("error" in result && result.error).toMatch(/Weigh the finished dish/);
  });

  it("keeps the raw-ingredient weight for servings when unweighed, as before", () => {
    const result = recipePortion({ ...maqlouba, cookedWeightG: null }, { amount: 1, unit: "serving" });
    if ("error" in result) throw new Error(result.error);
    expect(result.grams).toBeCloseTo(183.33, 1);
  });

  it("refuses an amount that is not one", () => {
    expect("error" in recipePortion(maqlouba, { amount: 0, unit: "serving" })).toBe(true);
  });
});

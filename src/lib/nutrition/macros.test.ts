import { describe, expect, it } from "vitest";

import {
  type Nutrients,
  addMacros,
  isNutrientRowPlausible,
  kcalFromMacros,
  macroSplit,
  macroTargets,
  multiplyMacros,
  proteinTargetG,
  scaleNutrients,
  sumMacros,
} from "@/lib/nutrition/macros";

// Per 100 g, roughly USDA cooked chicken breast.
const CHICKEN: Nutrients = {
  kcal: 165,
  protein_g: 31,
  carbs_g: 0,
  fat_g: 3.6,
};

describe("scaleNutrients", () => {
  it("scales a per-100 g row to a portion", () => {
    expect(scaleNutrients(CHICKEN, 200)).toEqual({
      kcal: 330,
      protein_g: 62,
      carbs_g: 0,
      fat_g: 7.2,
    });
  });

  it("handles portions below 100 g", () => {
    expect(scaleNutrients(CHICKEN, 50).kcal).toBe(82.5);
  });

  it("returns zeroes for a zero-gram portion", () => {
    expect(scaleNutrients(CHICKEN, 0).kcal).toBe(0);
  });

  it("rounds to the two decimals the columns store", () => {
    const scaled = scaleNutrients({ ...CHICKEN, kcal: 165.555 }, 33);
    expect(scaled.kcal).toBe(54.63);
  });

  it("rejects a negative weight rather than producing negative calories", () => {
    expect(() => scaleNutrients(CHICKEN, -10)).toThrow();
  });
});

describe("addMacros / sumMacros / multiplyMacros", () => {
  const a = { kcal: 330, protein_g: 62, carbs_g: 0, fat_g: 7.2 };
  const b = { kcal: 195, protein_g: 4.05, carbs_g: 42, fat_g: 0.45 };

  it("adds two entries", () => {
    expect(addMacros(a, b)).toEqual({
      kcal: 525,
      protein_g: 66.05,
      carbs_g: 42,
      fat_g: 7.65,
    });
  });

  it("sums an empty list to zero", () => {
    expect(sumMacros([])).toEqual({
      kcal: 0,
      protein_g: 0,
      carbs_g: 0,
      fat_g: 0,
    });
  });

  it("sums a list", () => {
    expect(sumMacros([a, b]).kcal).toBe(525);
  });

  it("scales a recipe by a serving count", () => {
    expect(multiplyMacros(a, 0.5)).toEqual({
      kcal: 165,
      protein_g: 31,
      carbs_g: 0,
      fat_g: 3.6,
    });
  });
});

describe("kcalFromMacros", () => {
  it("applies Atwater factors", () => {
    expect(kcalFromMacros({ protein_g: 10, carbs_g: 10, fat_g: 10 })).toBe(170);
  });
});

describe("isNutrientRowPlausible", () => {
  it("accepts a row whose calories match its macros", () => {
    expect(isNutrientRowPlausible(CHICKEN)).toBe(true);
  });

  it("accepts a genuinely zero-calorie row", () => {
    expect(
      isNutrientRowPlausible({ kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }),
    ).toBe(true);
  });

  it("flags a row whose stated calories contradict its macros", () => {
    // Community-contributed data is frequently wrong in exactly this way.
    expect(
      isNutrientRowPlausible({
        kcal: 500,
        protein_g: 1,
        carbs_g: 1,
        fat_g: 1,
      }),
    ).toBe(false);
  });

  it("tolerates the few percent of rounding drift real data carries", () => {
    expect(
      isNutrientRowPlausible({ kcal: 170, protein_g: 31, carbs_g: 0, fat_g: 3.6 }),
    ).toBe(true);
  });
});

describe("macroSplit", () => {
  it("returns the share of calories from each macro", () => {
    const split = macroSplit({
      kcal: 400,
      protein_g: 25,
      carbs_g: 50,
      fat_g: 10,
    });
    expect(split.protein + split.carbs + split.fat).toBeCloseTo(1, 6);
    expect(split.protein).toBeCloseTo(100 / 390, 4);
  });

  it("returns zeroes rather than dividing by zero", () => {
    expect(macroSplit({ kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 })).toEqual({
      protein: 0,
      carbs: 0,
      fat: 0,
    });
  });
});

describe("proteinTargetG", () => {
  it("puts the spec's starting weight near 180 g (spec 8.8)", () => {
    // 111.8 kg at the schema default of 1.6 g/kg.
    expect(proteinTargetG(111.8, 1.6)).toBe(179);
  });

  it("rejects a non-positive weight", () => {
    expect(() => proteinTargetG(0, 1.6)).toThrow();
  });
});

describe("macroTargets", () => {
  it("hits the protein target and spends the rest on fat and carbs", () => {
    const t = macroTargets(2250, 111.8, 1.6);
    expect(t.kcal).toBe(2250);
    expect(t.protein_g).toBe(179);

    const implied = kcalFromMacros(t);
    expect(implied).toBeCloseTo(2250, 0);
  });

  it("never drops fat below 20% of calories", () => {
    const t = macroTargets(2000, 100, 1.6, 0.05);
    expect(t.fat_g * 9).toBeGreaterThanOrEqual(2000 * 0.2 - 1);
  });

  it("does not produce negative carbs when protein is very high", () => {
    const t = macroTargets(1200, 120, 3.5);
    expect(t.carbs_g).toBeGreaterThanOrEqual(0);
    expect(t.fat_g).toBeGreaterThanOrEqual(0);
  });
});

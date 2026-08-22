/**
 * Macro arithmetic.
 *
 * Every calorie number the app ever displays is produced here, from a
 * per-100 g nutrient row and a gram weight. Nothing else computes nutrition,
 * and in particular the LLM never does — it returns intent, and the numbers
 * are looked up and multiplied here. See ARCHITECTURE invariant 1.
 */

/** Atwater factors: kcal per gram of each macronutrient. */
export const KCAL_PER_G_PROTEIN = 4;
export const KCAL_PER_G_CARBS = 4;
export const KCAL_PER_G_FAT = 9;

/** Per-100 g nutrition, mirroring `public.food_nutrients`. */
export type Nutrients = {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

/** Computed nutrition for an actual portion. */
export type MacroTotals = {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

export const ZERO_MACROS: MacroTotals = {
  kcal: 0,
  protein_g: 0,
  carbs_g: 0,
  fat_g: 0,
};

/**
 * Scales a per-100 g nutrient row to a gram weight.
 *
 * Rounded to two decimals to match the `numeric(9, 2)` / `numeric(8, 2)`
 * columns the result is written to, so what is displayed is what is stored.
 */
export function scaleNutrients(
  per100g: Nutrients,
  grams: number,
): MacroTotals {
  if (!Number.isFinite(grams) || grams < 0) {
    throw new Error("Grams must be a non-negative number.");
  }
  const factor = grams / 100;
  return {
    kcal: round2(per100g.kcal * factor),
    protein_g: round2(per100g.protein_g * factor),
    carbs_g: round2(per100g.carbs_g * factor),
    fat_g: round2(per100g.fat_g * factor),
  };
}

/** Adds macro totals. Used to fold a diary day, a recipe or a saved meal. */
export function addMacros(a: MacroTotals, b: MacroTotals): MacroTotals {
  return {
    kcal: round2(a.kcal + b.kcal),
    protein_g: round2(a.protein_g + b.protein_g),
    carbs_g: round2(a.carbs_g + b.carbs_g),
    fat_g: round2(a.fat_g + b.fat_g),
  };
}

export function sumMacros(items: readonly MacroTotals[]): MacroTotals {
  return items.reduce(addMacros, ZERO_MACROS);
}

/** Multiplies a macro set, e.g. scaling a recipe to a number of servings. */
export function multiplyMacros(m: MacroTotals, factor: number): MacroTotals {
  if (!Number.isFinite(factor) || factor < 0) {
    throw new Error("Factor must be a non-negative number.");
  }
  return {
    kcal: round2(m.kcal * factor),
    protein_g: round2(m.protein_g * factor),
    carbs_g: round2(m.carbs_g * factor),
    fat_g: round2(m.fat_g * factor),
  };
}

/**
 * Calories implied by the macros alone.
 *
 * Provider data is frequently internally inconsistent — a row's stated kcal
 * and its macros often disagree by a few percent because of rounding, fibre
 * handling or sugar alcohols. We keep the provider's stated kcal as the
 * truth and use this only to sanity-check it.
 */
export function kcalFromMacros(m: Omit<MacroTotals, "kcal">): number {
  return round2(
    m.protein_g * KCAL_PER_G_PROTEIN +
      m.carbs_g * KCAL_PER_G_CARBS +
      m.fat_g * KCAL_PER_G_FAT,
  );
}

/**
 * Whether a nutrient row's stated calories are plausible for its macros.
 *
 * Used to flag suspect community-contributed entries (Open Food Facts is
 * user-edited), not to correct them — the spec requires showing the source
 * and not presenting every entry as verified.
 */
export function isNutrientRowPlausible(
  n: Nutrients,
  tolerance = 0.25,
): boolean {
  const implied = kcalFromMacros(n);
  // A row with no macros at all (e.g. a zero-calorie drink) is fine.
  if (implied === 0 && n.kcal === 0) return true;
  if (implied === 0) return n.kcal <= 5;
  return Math.abs(n.kcal - implied) / implied <= tolerance;
}

/** Share of total calories from each macro. Sums to ~1 for a plausible row. */
export function macroSplit(m: MacroTotals): {
  protein: number;
  carbs: number;
  fat: number;
} {
  const total = kcalFromMacros(m);
  if (total <= 0) return { protein: 0, carbs: 0, fat: 0 };
  return {
    protein: (m.protein_g * KCAL_PER_G_PROTEIN) / total,
    carbs: (m.carbs_g * KCAL_PER_G_CARBS) / total,
    fat: (m.fat_g * KCAL_PER_G_FAT) / total,
  };
}

/**
 * Daily protein target in grams.
 *
 * Driven by bodyweight, not by calories, because protein is the variable the
 * cut mode protects: intake falls over a phase while the protein floor holds
 * (spec 8.8, "prioritize muscle retention"). `goals.protein_g_per_kg`
 * defaults to 1.6, which puts 111.8 kg at ~179 g.
 */
export function proteinTargetG(weightKg: number, gPerKg: number): number {
  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    throw new Error("Weight must be a positive number.");
  }
  return Math.round(weightKg * gPerKg);
}

/**
 * Splits a calorie target into macros.
 *
 * Protein is fixed from bodyweight first and fat is set as a share of total
 * calories, with carbohydrate taking whatever remains — the standard ordering
 * when protein is the constraint being defended. Fat is floored at 20% of
 * calories so a large deficit cannot drive it to a level that costs hormonal
 * function.
 */
export function macroTargets(
  calories: number,
  weightKg: number,
  proteinGPerKg: number,
  fatShare = 0.28,
): MacroTotals {
  const protein_g = proteinTargetG(weightKg, proteinGPerKg);
  const proteinKcal = protein_g * KCAL_PER_G_PROTEIN;

  const fatKcal = Math.max(calories * Math.max(fatShare, 0.2), 0);
  // Protein and fat together must still leave room for some carbohydrate.
  const cappedFatKcal = Math.min(fatKcal, Math.max(calories - proteinKcal, 0));
  const fat_g = round2(cappedFatKcal / KCAL_PER_G_FAT);

  const carbsKcal = Math.max(calories - proteinKcal - cappedFatKcal, 0);
  const carbs_g = round2(carbsKcal / KCAL_PER_G_CARBS);

  return { kcal: Math.round(calories), protein_g, carbs_g, fat_g };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

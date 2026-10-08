/**
 * How much of a recipe was eaten, and what it costs (spec §13G).
 *
 * In servings, always: a serving is the recipe divided by how many it
 * makes. In grams, only when the finished dish was weighed
 * (`recipes.cooked_weight_g`): a gram is then a known fraction of the pot.
 * Without that weight the recipe knows only its *raw* ingredient weights,
 * and a cooked plate is not a raw plate — rice drinks its water — so grams
 * are refused rather than guessed.
 *
 * The macros come from `perServing`, which the caller computed from the
 * ingredients' nutrient rows; nothing here is a figure anyone typed.
 *
 * Pure.
 */

import { type MacroTotals, multiplyMacros } from "@/lib/nutrition/macros";

export type RecipeBasis = {
  perServing: MacroTotals;
  servings: number;
  /** Sum of the ingredients' raw grams. */
  rawGrams: number;
  /** What the finished dish weighed, if it was weighed. */
  cookedWeightG: number | null;
};

export type RecipePortionInput = { amount: number; unit: "serving" | "g" };

export type RecipePortion = {
  servingsEaten: number;
  /** The real weight of the portion, as well as it is known. */
  grams: number;
  macros: MacroTotals;
};

export function recipePortion(
  basis: RecipeBasis,
  portion: RecipePortionInput,
): RecipePortion | { error: string } {
  if (!Number.isFinite(portion.amount) || portion.amount <= 0) {
    return { error: "The amount must be above zero." };
  }
  if (!(basis.servings > 0)) return { error: "That recipe has no servings set." };

  // The dish's own weight per serving when it was weighed; otherwise the
  // raw ingredients', which is what the diary has always recorded.
  const gramsPerServing = (basis.cookedWeightG ?? basis.rawGrams) / basis.servings;

  let servingsEaten: number;
  if (portion.unit === "g") {
    if (basis.cookedWeightG === null) {
      return {
        error:
          "Weigh the finished dish once and save its weight on the recipe — then it can be logged in grams. Until then, log it in servings.",
      };
    }
    servingsEaten = portion.amount / gramsPerServing;
  } else {
    servingsEaten = portion.amount;
  }

  return {
    servingsEaten,
    grams: Math.max(
      portion.unit === "g" ? portion.amount : gramsPerServing * servingsEaten,
      0.001,
    ),
    macros: multiplyMacros(basis.perServing, servingsEaten),
  };
}

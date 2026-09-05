import "server-only";

/**
 * Turning model intent into real foods.
 *
 * This is where the AI path rejoins the manual one (ARCHITECTURE §4). The
 * model said *what* and *how much*; everything numeric from here is looked
 * up: each `query` goes through the same `searchFoods` fan-out the search box
 * uses, and the calories come from the matched food's nutrient row via the
 * same `scaleNutrients` the diary uses.
 *
 * Nothing here consults the model again, and nothing here can be reached
 * with a nutrition figure the model supplied — `FoodIntent` has no field for
 * one.
 */

import type { Food } from "@/lib/food/types";
import { searchFoods } from "@/lib/food/registry";
import type { FoodIntent } from "@/lib/llm/types";
import { type MacroTotals, scaleNutrients } from "@/lib/nutrition/macros";
import { toGrams } from "@/lib/nutrition/units";

/** How many other candidates to offer when the top match is wrong. */
const ALTERNATIVES = 4;

export type FoodProposal = {
  /** What the model understood. Shown so a misreading is visible. */
  intent: FoodIntent;
  /** Best match, or null when the search found nothing usable. */
  match: Food | null;
  /** Other candidates, so a wrong first guess costs one click. */
  alternatives: Food[];
  /** The portion in grams, once resolved against the matched food. */
  grams: number | null;
  /** Computed from the matched food's nutrients, never from the model. */
  macros: MacroTotals | null;
};

export type ResolvedIntents = {
  proposals: FoodProposal[];
  /** True when a provider was down, so the UI can say results are partial. */
  degraded: boolean;
};

/**
 * Resolves every intent concurrently.
 *
 * One search per intent: a three-food sentence is three fan-outs, which is
 * what the rate limit on the route is sized against.
 */
export async function resolveIntents(
  intents: readonly FoodIntent[],
): Promise<ResolvedIntents> {
  const results = await Promise.all(intents.map(resolveOne));

  return {
    proposals: results.map((r) => r.proposal),
    degraded: results.some((r) => r.degraded),
  };
}

async function resolveOne(
  intent: FoodIntent,
): Promise<{ proposal: FoodProposal; degraded: boolean }> {
  const outcome = await searchFoods({
    text: intent.query,
    limit: ALTERNATIVES + 1,
  });

  const [match = null, ...alternatives] = outcome.foods;

  return {
    degraded: outcome.degraded,
    proposal: {
      intent,
      match,
      alternatives: alternatives.slice(0, ALTERNATIVES),
      ...portionFor(intent, match),
    },
  };
}

/**
 * Resolves the portion and its macros against a specific food.
 *
 * Exported because switching to an alternative has to redo exactly this —
 * a different food has different servings, so the gram weight of "1 serving"
 * changes with the choice.
 */
export function portionFor(
  intent: FoodIntent,
  food: Food | null,
): { grams: number | null; macros: MacroTotals | null } {
  if (!food) return { grams: null, macros: null };

  const serving =
    intent.unit === "serving"
      ? (food.servings.find((s) => s.isDefault) ?? food.servings[0] ?? null)
      : null;

  // A serving-based amount with no serving to measure would need an invented
  // gram weight, which is exactly what `toGrams` refuses to do.
  if (intent.unit === "serving" && !serving) {
    return { grams: null, macros: null };
  }

  try {
    const grams = toGrams({
      amount: intent.amount,
      unit: intent.unit,
      serving: serving ? { grams: serving.grams } : null,
    });
    return { grams, macros: scaleNutrients(food.nutrients, grams) };
  } catch {
    return { grams: null, macros: null };
  }
}

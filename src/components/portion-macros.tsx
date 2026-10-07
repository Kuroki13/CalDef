"use client";

/**
 * What this portion actually costs, before it is logged.
 *
 * Every screen that asks for an amount now shows the same line in the same
 * words, computed the same way — `toGrams` then `scaleNutrients`, which are
 * the functions the server uses when it writes the entry. So the number on
 * screen is the number that lands in the diary, and logging holds no
 * surprises.
 *
 * Per-100 g figures are still shown in a results list, where they are the
 * only figure that compares two foods fairly. They are not enough on their
 * own once an amount exists: nobody eats 100 g of olive oil, and "884 kcal
 * / 100 g" is not an answer to "what is a tablespoon of this".
 */

import { scaleNutrients } from "@/lib/nutrition/macros";
import { toGrams, type PortionUnit } from "@/lib/nutrition/units";
import type { Food, FoodServing } from "@/lib/food/types";
import { amountUnit, formatAmount } from "@/lib/food/basis";

/**
 * Resolves the portion the way the server will.
 *
 * Returns null when the amount cannot be weighed — an unparseable number,
 * or a serving with no gram weight behind it — because inventing one is
 * exactly what `toGrams` refuses to do.
 */
export function portionMacros(
  food: Food,
  amount: number,
  unit: PortionUnit,
  serving?: FoodServing | null,
) {
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) return null;
  if (unit === "serving" && !serving) return null;

  try {
    const grams = toGrams({
      amount,
      unit,
      serving: serving ? { grams: serving.grams } : null,
    });
    return { grams, macros: scaleNutrients(food.nutrients, grams) };
  } catch {
    return null;
  }
}

export function PortionMacros({
  food,
  amount,
  unit,
  serving,
  className,
}: {
  food: Food;
  amount: number;
  unit: PortionUnit;
  serving?: FoodServing | null;
  className?: string;
}) {
  const resolved = portionMacros(food, amount, unit, serving);

  if (!resolved) {
    return (
      <p className={className ?? "text-muted-foreground text-sm"}>
        {unit === "serving" && !serving
          ? "This food has no serving weight. Choose grams and enter the weight."
          : "Enter an amount to see what it costs."}
      </p>
    );
  }

  const { grams, macros } = resolved;

  return (
    <p className={className ?? "text-sm"} aria-live="polite">
      <span className="font-medium tabular-nums">
        {Math.round(macros.kcal)} kcal
      </span>{" "}
      <span className="text-muted-foreground tabular-nums">
        · Protein {macros.protein_g.toFixed(1)} g · Carbs{" "}
        {macros.carbs_g.toFixed(1)} g · Fat {macros.fat_g.toFixed(1)} g
        {/* The resolved size, in the food's own unit. Said only when it adds
            something: "100 ml" of a drink is already its own size, while a
            serving, or ml of a weighed food, is worth translating. */}
        {unit !== amountUnit(food)
          ? ` · ${formatAmount(food, Math.round(grams))}`
          : ""}
      </span>
    </p>
  );
}

/**
 * What a results row is worth eating, not only per 100 g.
 *
 * A list has no amount yet, so the honest second figure is the food's own
 * default serving where it has one — "1 bar · 190 kcal" tells you more
 * about a flapjack than "422 kcal / 100 g" does.
 */
export function ServingHint({ food }: { food: Food }) {
  const serving = food.servings.find((s) => s.isDefault) ?? food.servings[0];
  if (!serving) return null;

  const resolved = portionMacros(food, 1, "serving", serving);
  if (!resolved) return null;

  return (
    <span className="tabular-nums">
      {" · "}
      {serving.label}: {Math.round(resolved.macros.kcal)} kcal
    </span>
  );
}

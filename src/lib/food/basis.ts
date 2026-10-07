/**
 * How a food's amounts read back: grams for something weighed, millilitres
 * for a drink.
 *
 * Nutrients are stored per 100 g for every food, and ml resolves at 1 g/ml
 * (`nutrition/units.ts`), so a drink's stored figures *are* its per-100 ml
 * figures. What changes is only the word shown beside them — and showing
 * "per 100 g" beside a carton of milk is the kind of small wrongness that
 * makes someone distrust the numbers that are right.
 *
 * Pure, so it is usable from server and client components alike.
 */

import type { Food } from "@/lib/food/types";

/** The unit a food's amounts are expressed in. */
export function amountUnit(food: Pick<Food, "basisUnit">): "g" | "ml" {
  return food.basisUnit === "ml" ? "ml" : "g";
}

/** "100 g" or "100 ml" — what the stored figures are per. */
export function per100Label(food: Pick<Food, "basisUnit">): string {
  return `100 ${amountUnit(food)}`;
}

/** A stored gram figure in the food's own unit: "45 g", "330 ml". */
export function formatAmount(food: Pick<Food, "basisUnit">, grams: number): string {
  const rounded = Number.isInteger(grams) ? grams : Number(grams.toFixed(1));
  return `${rounded} ${amountUnit(food)}`;
}

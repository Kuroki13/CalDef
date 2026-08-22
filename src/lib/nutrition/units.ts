/**
 * Portion units — turning what the user typed into grams.
 *
 * Everything in this app is computed from per-100 g nutrient rows, so the
 * first thing any logging path does is resolve an amount to grams. This
 * module is that single conversion, and it is deliberately the only place
 * that knows what a `portion_unit` means.
 *
 * (Body measurements — kg, cm, lb, in — are a separate concern and live in
 * `src/lib/units.ts`.)
 */

/** Matches the `public.portion_unit` enum. */
export type PortionUnit = "g" | "ml" | "serving";

/**
 * Millilitres are treated as grams at 1 g/ml unless the food supplies a
 * named serving that says otherwise.
 *
 * This is right for water and close enough for most drinks. It is wrong for
 * oil (~0.92) and honey (~1.42), which is exactly why a food's own
 * `food_servings` row always wins over this fallback: "1 tbsp olive oil"
 * resolves through the serving, not through this constant.
 */
export const DEFAULT_ML_TO_G = 1;

export type ServingRef = {
  /** Grams in one of these servings, from `food_servings.grams`. */
  grams: number;
};

export type PortionInput = {
  amount: number;
  unit: PortionUnit;
  /** Required when `unit` is `"serving"`. */
  serving?: ServingRef | null;
};

export class PortionError extends Error {}

/**
 * Resolves a portion to grams.
 *
 * Throws rather than guessing when a serving-based amount arrives without a
 * serving: silently substituting a number here would put a fabricated weight
 * into the diary, which is the one thing the whole nutrition path exists to
 * prevent.
 */
export function toGrams({ amount, unit, serving }: PortionInput): number {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new PortionError("Amount must be a positive number.");
  }

  switch (unit) {
    case "g":
      return amount;
    case "ml":
      return amount * DEFAULT_ML_TO_G;
    case "serving": {
      if (!serving || !Number.isFinite(serving.grams) || serving.grams <= 0) {
        throw new PortionError(
          "A serving-based amount needs a serving with a gram weight.",
        );
      }
      return amount * serving.grams;
    }
  }
}

/** Chooses the serving to preselect in the UI: the default, else the first. */
export function pickDefaultServing<T extends { is_default: boolean }>(
  servings: readonly T[],
): T | null {
  return servings.find((s) => s.is_default) ?? servings[0] ?? null;
}

/** How a logged amount reads back to the user, e.g. `2 × 1 medium (240 g)`. */
export function describePortion(
  amount: number,
  unit: PortionUnit,
  servingLabel?: string | null,
): string {
  if (unit === "serving") {
    const label = servingLabel?.trim() || "serving";
    return `${formatAmount(amount)} × ${label}`;
  }
  return `${formatAmount(amount)} ${unit}`;
}

/** Trims trailing zeros so 200 reads as "200", not "200.0". */
function formatAmount(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

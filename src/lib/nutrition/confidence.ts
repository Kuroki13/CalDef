/**
 * How far a logged figure can be trusted (spec §11.3, §12H).
 *
 * Four levels, as the spec names them, and deliberately no more — "do not
 * over-engineer the labels initially":
 *
 * - **exact**: the numbers are the food's own. A label the user copied, an
 *   official restaurant item, a recipe they built from weighed ingredients.
 * - **strong**: a clear match in a reliable database. USDA's analysed data,
 *   or a branded product's label as Open Food Facts records it.
 * - **estimated**: real data, but something about this portion is assumed —
 *   a recipe the assistant drafted, or a weighed food poured in millilitres
 *   at 1 g/ml.
 * - **rough**: the user's own estimate, attached to no food (Quick Add).
 *
 * Nothing here changes a number. It says where the number came from, so
 * that uncertainty is visible instead of disguised as precision — the
 * spec's "false precision is worse than honest uncertainty". It will later
 * feed how much weight a day gets in the expenditure estimate (§14.1).
 *
 * Pure: everything it needs is passed in.
 */

export type Confidence = "exact" | "strong" | "estimated" | "rough";

export type EntryProvenance = {
  isEstimate: boolean;
  /** The food behind a single-food entry; null for recipes and estimates. */
  food: {
    source: "usda" | "off" | "custom" | "ciqual" | "cnf";
    isVerified: boolean;
    /** A custom row imported from the reviewed restaurant catalogue. */
    isRestaurantReference: boolean;
    basisUnit: "g" | "ml";
  } | null;
  /** The recipe behind a recipe entry; null otherwise. */
  recipe: { aiDrafted: boolean } | null;
  unit: "g" | "ml" | "serving";
};

export function entryConfidence(entry: EntryProvenance): Confidence {
  if (entry.isEstimate) return "rough";

  if (entry.recipe) return entry.recipe.aiDrafted ? "estimated" : "exact";

  const food = entry.food;
  if (!food) return "rough";

  // A weighed food logged by volume rests on 1 g/ml, which is right for
  // water and wrong for oil or honey: an approximated portion.
  if (entry.unit === "ml" && food.basisUnit !== "ml") return "estimated";

  if (food.source === "custom") return "exact";
  if (food.source === "usda") return food.isVerified ? "strong" : "estimated";
  // National, laboratory-based tables, like USDA's (§13J/§13K).
  if (food.source === "ciqual" || food.source === "cnf") {
    // A CNF recipe compilation is computed from ingredients, not analysed.
    return food.isVerified ? "strong" : "estimated";
  }
  return "strong";
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  exact: "Exact",
  strong: "Strong",
  estimated: "Estimated",
  rough: "Rough",
};

/** One line on where the level comes from, for a tooltip or screen reader. */
export const CONFIDENCE_EXPLANATION: Record<Confidence, string> = {
  exact: "The food's own figures: your label, an official restaurant item, or a recipe you built.",
  strong: "A clear match in a reliable database.",
  estimated: "Real data, but part of this portion is assumed.",
  rough: "Your own estimate, not attached to a food.",
};

/**
 * The share of a day's calories that are estimated or rough, 0 to 1.
 *
 * What the spec's daily line reports: "27% of today's intake comes from
 * estimated foods". Null when nothing was eaten, because a share of nothing
 * is not zero.
 */
export function estimatedShare(
  entries: readonly { kcal: number; confidence: Confidence }[],
): number | null {
  const total = entries.reduce((sum, e) => sum + e.kcal, 0);
  if (total <= 0) return null;
  const uncertain = entries
    .filter((e) => e.confidence === "estimated" || e.confidence === "rough")
    .reduce((sum, e) => sum + e.kcal, 0);
  return uncertain / total;
}

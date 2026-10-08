/**
 * Which of the user's recipes answer a search (spec §13G).
 *
 * "I ate 450 g maqlouba" should reach Mom's Chicken Maqlouba first. A
 * recipe answers a query when its name holds every word typed, or when its
 * name names the same dish the query named, however spelled ("ma2loubeh"
 * and "Mom's Chicken Maqlouba"). Of those, one whose name names the variant
 * asked for — chicken — comes before one that does not.
 *
 * Runs on the server over the caller's own recipe names. The recipe list is
 * never sent to a model (§13.2).
 *
 * Pure.
 */

import { recognise } from "@/lib/food/cultural/recognise";
import { fold, terms } from "@/lib/food/text-match";

export type RecipeName = { id: number; name: string; isFamily?: boolean };

export type QueryDish = { id: string; variantId: string | null } | null;

/** A search list, not the recipe book. */
export const MAX_RECIPE_HITS = 5;

export function matchRecipes<T extends RecipeName>(
  recipes: readonly T[],
  query: string,
  dish: QueryDish,
): T[] {
  const wanted = terms(query);

  const scored = recipes.flatMap((recipe, index) => {
    const haystack = fold(recipe.name);
    const literal = wanted.length > 0 && wanted.every((term) => haystack.includes(term));
    const named = dish ? recognise(recipe.name).find((r) => r.dish.id === dish.id) : undefined;
    if (!literal && !named) return [];

    const sameVariant =
      dish?.variantId != null && named?.variant?.id === dish.variantId ? 1 : 0;
    const otherVariant =
      dish?.variantId != null && named?.variant && named.variant.id !== dish.variantId ? 1 : 0;
    // A family dish is what the word means at home (§13G, §13H): a nudge
    // within equals, never enough to pass the variant that was asked for.
    const family = recipe.isFamily ? 0.5 : 0;
    return [
      { recipe, index, score: sameVariant * 2 - otherVariant + (literal ? 1 : 0) + family },
    ];
  });

  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_RECIPE_HITS)
    .map((s) => s.recipe);
}

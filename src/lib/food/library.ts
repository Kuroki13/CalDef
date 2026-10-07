import "server-only";

/**
 * My Foods — the personal library (spec §12B).
 *
 * Everything the user has made theirs, in one place: what they ate
 * recently, what they eat often, what they starred, what they typed in off a
 * packet, what they scanned, and their recipes and saved meals. None of it
 * is new data. It is read from the diary, `favorite_foods`, owned `foods`
 * rows, `recipes` and `saved_meals`, which already exist; this module only
 * assembles them, so there is no second copy to drift.
 *
 * Every read is the caller's own: RLS scopes the diary, favourites, recipes
 * and meals, and owned foods are visible to their owner alone.
 *
 * A failure in any one part leaves that part empty rather than failing the
 * diary page it is shown on. Not being offered a shortcut is a worse
 * experience; not being able to log at all is a broken one.
 */

import { getFavorites } from "@/lib/favorites";
import { getCachedFoodsByIds } from "@/lib/food/cache";
import { listCustomFoods } from "@/lib/food/custom";
import {
  type LogSignal,
  frequentFoodIds,
  recentFoodIds,
  scannedFoodIds,
  summariseUse,
} from "@/lib/food/library-rank";
import type { PersonalLibrary } from "@/lib/food/library-types";
import type { CachedFood } from "@/lib/food/types";
import { listRecipes } from "@/lib/recipes";
import { listSavedMeals } from "@/lib/saved-meals";
import { createClient } from "@/lib/supabase/server";

/** How far back "recent" and "frequent" look. */
export const LIBRARY_HISTORY_ROWS = 500;

async function settle<T>(work: Promise<T>, fallback: T): Promise<T> {
  try {
    return await work;
  } catch {
    return fallback;
  }
}

async function diarySignals(): Promise<LogSignal[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("food_logs")
    .select("food_id, source, created_at")
    .not("food_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(LIBRARY_HISTORY_ROWS);
  if (error) throw new Error(error.message);

  return (data ?? []).flatMap((row) =>
    row.food_id === null
      ? []
      : [{ foodId: row.food_id, source: row.source, loggedAt: row.created_at }],
  );
}

export async function getPersonalLibrary(): Promise<PersonalLibrary> {
  const [signals, favorites, custom, recipes, meals] = await Promise.all([
    settle(diarySignals(), []),
    settle(getFavorites(), []),
    settle(listCustomFoods(), []),
    settle(listRecipes(), []),
    settle(listSavedMeals(), []),
  ]);

  const uses = summariseUse(signals);
  const recentIds = recentFoodIds(uses);
  const frequentIds = frequentFoodIds(uses);
  const scannedIds = scannedFoodIds(uses);

  const wanted = [...new Set([...recentIds, ...frequentIds, ...scannedIds])];
  const foods = await settle(getCachedFoodsByIds(wanted), []);
  const byId = new Map(foods.map((food) => [food.id, food]));
  // In the order the ranking chose; a food that is gone (retired, or no
  // longer readable) simply drops out.
  const pick = (ids: number[]) =>
    ids.flatMap((id) => (byId.has(id) ? [byId.get(id) as CachedFood] : []));

  return {
    recent: pick(recentIds),
    frequent: pick(frequentIds),
    favorites,
    // Most used first: the food typed in off a packet and eaten every day
    // belongs above the one tried once. Ties keep `listCustomFoods`'s
    // newest-first order, since the sort is stable.
    custom: [...custom].sort((a, b) => b.useCount - a.useCount),
    scanned: pick(scannedIds),
    recipes: recipes.map((detail) => ({
      id: detail.recipe.id,
      name: detail.recipe.name,
      servings: Number(detail.recipe.servings),
      kcalPerServing: detail.perServing.kcal,
      hasIngredients: detail.ingredients.length > 0,
    })),
    meals: meals.map((detail) => ({
      id: detail.meal.id,
      name: detail.meal.name,
      itemCount: detail.items.length,
      kcal: detail.totals.kcal,
      defaultMealTypeId: detail.meal.default_meal_type_id,
    })),
  };
}

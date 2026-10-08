import "server-only";

/**
 * The search fan-out.
 *
 * Queries the cache and every configured provider at once, merges the
 * results and reports which sources answered. This is where ARCHITECTURE
 * invariant 7 lives: a dead provider removes its own contribution and
 * nothing else — the search still returns whatever the other sources found,
 * with a note that it is incomplete.
 */

import {
  cacheFood,
  getCachedFoodsByIds,
  ownFoodsNamingDish,
  refreshCachedFood,
  searchCache,
} from "@/lib/food/cache";
import { type Recognised, namesDish, recognise } from "@/lib/food/cultural/recognise";
import { hasStrongMatch } from "@/lib/food/text-match";
import { getRecipe, listRecipeNames } from "@/lib/recipes";
import { matchRecipes } from "@/lib/recipe-match";
import { learnedFor } from "@/lib/vocabulary";
import { PINNED_AT } from "@/lib/vocabulary-key";
import { ciqualProvider } from "@/lib/food/ciqual";
import { cnfProvider } from "@/lib/food/cnf";
import { offProvider } from "@/lib/food/off";
import { usdaProvider } from "@/lib/food/usda";
import { personalSignals } from "@/lib/food/history";
import { type PersonalSignals, rankFoods } from "@/lib/food/personal-rank";
import { safeProviderCall } from "@/lib/food/provider";
import { isStale } from "@/lib/food/staleness";
import { searchRestaurantCatalogue } from "@/lib/food/restaurant-catalogue";
import type {
  CachedFood,
  Food,
  FoodSearchQuery,
  ProviderResult,
  RecipeHit,
  RecognisedDish,
  SearchOutcome,
} from "@/lib/food/types";

// Ciqual and the CNF answer from bundled tables (no network), so they cost
// nothing to ask on every search (§13J/§13K).
export const PROVIDERS = [usdaProvider, ciqualProvider, cnfProvider, offProvider];

/**
 * Searches every source and merges the results.
 *
 * Cache hits are listed first: they are the foods this user has actually
 * logged before, which makes them the most likely match, and they cost no
 * network call.
 */
export async function searchFoods(
  query: FoodSearchQuery,
): Promise<SearchOutcome> {
  // §13A: a dish named in any spelling or script is searched by the phrase
  // the databases file it under — "7ummus" is looked up as "hummus",
  // "ma2loubeh djej" as "chicken maqluba". The cache is searched with what
  // was typed as well, since the user's own food may carry their spelling.
  const dish = recognise(query.text)[0] ?? null;
  const providerQuery = dish ? { ...query, text: dish.searchAs } : query;
  const rankText = providerQuery.text;

  const [cacheResult, cacheByDish, ownDishFoods, history, matchedRecipes, learnedAll] = await Promise.all([
    safeProviderCall("cache", () => searchCache(query)),
    dish && dish.searchAs !== query.text
      ? safeProviderCall("cache", () => searchCache(providerQuery))
      : Promise.resolve(null),
    dish ? ownFoodsNamingDish(dish.dish.id).catch(() => []) : Promise.resolve([]),
    personalSignals(),
    // §13G: the user's own recipes answer before any database does.
    recipeHits(query.text, dish).catch(() => []),
    // §13I: what this exact phrase has meant to this user before.
    learnedFor(query.text).catch(() => []),
  ]);

  // A habit, not a one-off: twice for the same phrase before it leads.
  const learned = learnedAll.filter((pick) => pick.count >= PINNED_AT);
  const learnedFoodIds = learned.flatMap((p) => (p.foodId === null ? [] : [p.foodId]));
  const learnedRecipeIds = learned.flatMap((p) => (p.recipeId === null ? [] : [p.recipeId]));

  // A learned item may share no word with the phrase — "the usual" — so it
  // is fetched by id rather than hoped for in the results.
  const [learnedFoods, learnedRecipes] = await Promise.all([
    getCachedFoodsByIds(learnedFoodIds).catch(() => []),
    Promise.all(
      learnedRecipeIds
        .filter((id) => !matchedRecipes.some((r) => r.id === id))
        .map((id) => recipeHitById(id).catch(() => null)),
    ),
  ]);
  const recipes = pinFirst(
    [...matchedRecipes, ...learnedRecipes.flatMap((r) => (r ? [r] : []))],
    (r) => learnedRecipeIds.indexOf(r.id),
  );

  const providerResults = await Promise.all(
    PROVIDERS.map((provider) => provider.search(providerQuery)),
  );

  const results = [cacheResult, ...providerResults];

  // The providers have just answered anyway, so a cached row that has gone
  // stale can be brought up to date for nothing. Awaited rather than left
  // running: a serverless function that returns may be frozen mid-write.
  const refreshed = await refreshStaleHits(
    cacheResult.foods as CachedFood[],
    providerResults.flatMap((result) => result.foods),
  );

  const namesSameDish = (food: Food) =>
    dish !== null && namesDish(food.name, dish.dish.id);

  const references = searchRestaurantCatalogue(query.text);
  const rankedByText = rank(
    dedupe([
      ...refreshed,
      ...learnedFoods,
      ...ownDishFoods,
      ...results.flatMap((r) => r.foods),
      ...(cacheByDish?.foods ?? []),
    ]),
    rankText,
    history,
    namesSameDish,
  );
  const ranked = pinFirst(rankedByText, (food) => {
    const id = (food as { id?: number }).id;
    return typeof id === "number" ? learnedFoodIds.indexOf(id) : -1;
  });
  // What the user has picked for this phrase leads even a restaurant
  // reference: it is the answer they have given twice already.
  const learnedFirst = ranked.slice(0, learnedFoods.length).filter((food) =>
    learnedFoodIds.includes((food as { id?: number }).id ?? -1),
  );
  const foods = dedupe([...learnedFirst, ...references, ...ranked]);

  return {
    foods,
    results,
    degraded: results.some((r) => !r.ok),
    // §13E: no question when the user's own food already answers it —
    // "Mom's Maqlouba" is which kind.
    recognised: dish
      ? {
          ...describeRecognised(dish),
          variantOpen:
            dish.variantOpen &&
            ownDishFoods.length === 0 &&
            recipes.length === 0 &&
            learned.length === 0,
        }
      : null,
    recipes,
    learned: learned.map((p) => ({
      vocabularyId: p.vocabularyId,
      foodId: p.foodId,
      recipeId: p.recipeId,
      count: p.count,
    })),
    strongMatch:
      learned.length > 0 ||
      recipes.length > 0 ||
      references.length > 0 ||
      ranked.some(namesSameDish) ||
      (rankText.trim().split(/\s+/).length > 1
        ? hasStrongMatch(rankText, ranked)
        : ranked.length > 0),
  };
}

/**
 * Writes fresh provider data over the cached rows that have expired.
 *
 * Only where the same food came back from its own provider in this very
 * search, so nothing is invented and no extra request is made. Returns the
 * refreshed foods, which are put in front of the stale copies they replace —
 * otherwise the search that performed the refresh would still show the old
 * numbers, which is a confusing way to find out it worked.
 */
async function refreshStaleHits(
  cached: readonly CachedFood[],
  fromProviders: readonly Food[],
): Promise<CachedFood[]> {
  const stale = cached.filter((food) => isStale(food.refreshedAt ?? null));
  if (stale.length === 0) return [];

  const byKey = new Map(
    fromProviders.map((food) => [`${food.source}:${food.sourceId}`, food]),
  );

  const updated: CachedFood[] = [];
  for (const food of stale) {
    const fresh = byKey.get(`${food.source}:${food.sourceId}`);
    if (!fresh) continue;

    if (await refreshCachedFood(food.id, fresh)) {
      updated.push({ ...fresh, id: food.id, refreshedAt: new Date().toISOString() });
    }
  }

  return updated;
}

/**
 * Orders merged results: by how much of the query each accounts for, then
 * by the user's own history within that (spec §12C, `personal-rank.ts`).
 *
 * Without any ordering the fan-out decided — cache, then USDA, then Open
 * Food Facts — so "Dubai chocolate" returned "Beverages, chocolate syrup"
 * first, because USDA answers first and matched one word of two. The first
 * result is the one the AI path proposes and the one a hurried user taps,
 * so its order is not cosmetic.
 */
function rank(
  foods: readonly Food[],
  text: string,
  signals?: PersonalSignals,
  namesSameDish?: (food: Food) => boolean,
): Food[] {
  return rankFoods(foods, text, signals, namesSameDish);
}

/**
 * The caller's recipes that answer the query, with what one serving costs.
 *
 * Names are matched first, from a light read; only the few that match are
 * read in full. RLS limits both reads to the caller's own recipes, and the
 * matching happens here — the recipe book never leaves the server (§13.2).
 * A recipe with no ingredients cannot be logged and is not offered.
 */
async function recipeHits(text: string, dish: Recognised | null): Promise<RecipeHit[]> {
  const names = await listRecipeNames();
  const matched = matchRecipes(
    names,
    text,
    dish ? { id: dish.dish.id, variantId: dish.variant?.id ?? null } : null,
  );
  const details = await Promise.all(matched.map((r) => getRecipe(r.id)));
  return details.flatMap((detail) =>
    detail && detail.ingredients.length > 0
      ? [
          {
            id: detail.recipe.id,
            name: detail.recipe.name,
            servings: Number(detail.recipe.servings),
            kcalPerServing: detail.perServing.kcal,
            proteinPerServing: detail.perServing.protein_g,
            isFamily: detail.recipe.is_family,
            cookedWeightG:
              detail.recipe.cooked_weight_g === null
                ? null
                : Number(detail.recipe.cooked_weight_g),
          },
        ]
      : [],
  );
}

/**
 * Moves the items `order` names (index ≥ 0) to the front, in that order;
 * everything else keeps its place behind them.
 */
function pinFirst<T>(items: readonly T[], order: (item: T) => number): T[] {
  const pinned = items
    .map((item) => ({ item, at: order(item) }))
    .filter((p) => p.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((p) => p.item);
  return [...pinned, ...items.filter((item) => order(item) < 0)];
}

async function recipeHitById(id: number): Promise<RecipeHit | null> {
  const detail = await getRecipe(id);
  if (!detail || detail.ingredients.length === 0) return null;
  return {
    id: detail.recipe.id,
    name: detail.recipe.name,
    servings: Number(detail.recipe.servings),
    kcalPerServing: detail.perServing.kcal,
    proteinPerServing: detail.perServing.protein_g,
    isFamily: detail.recipe.is_family,
    cookedWeightG:
      detail.recipe.cooked_weight_g === null ? null : Number(detail.recipe.cooked_weight_g),
  };
}

/** What the screen is told about a recognised dish — names, never numbers. */
function describeRecognised(found: Recognised): RecognisedDish {
  return {
    id: found.dish.id,
    name: found.dish.name,
    arabic: found.dish.arabic,
    about: found.dish.about,
    variant: found.variant ? { id: found.variant.id, label: found.variant.label } : null,
    variants: (found.dish.variants ?? []).map((v) => ({
      id: v.id,
      label: v.label,
      searchAs: v.searchAs,
    })),
    variantOpen: found.variantOpen,
    searchAs: found.searchAs,
  };
}

/**
 * Resolves a barcode: cache first, then Open Food Facts.
 *
 * A hit from the network is cached before it is returned, so scanning the
 * same product twice costs one request rather than two.
 */
export async function lookupBarcode(barcode: string): Promise<Food | null> {
  const { findCachedByBarcode } = await import("@/lib/food/cache");

  const cached = await findCachedByBarcode(barcode);

  // A fresh hit is the whole point of the cache: answer from it and make no
  // request at all. A stale one is worth one request, because a scanned
  // product is exactly where a corrected figure matters — and a custom food
  // is the user's own and is never refreshed from a provider.
  if (cached && (cached.source === "custom" || !isStale(cached.refreshedAt ?? null))) {
    return cached;
  }

  if (!offProvider.lookupBarcode) return cached;

  const found = await offProvider.lookupBarcode(barcode);
  // The provider being down or having dropped the product is not a reason to
  // withhold the copy we already hold.
  if (!found) return cached;

  if (cached) {
    await refreshCachedFood(cached.id, found);
    const refreshed: CachedFood = { ...found, id: cached.id };
    return refreshed;
  }

  await cacheFood(found);
  return found;
}


/**
 * Merges result sets, preferring the earlier source on a collision.
 *
 * Deduplicates on `(source, sourceId)` — the same food genuinely present in
 * both USDA and Open Food Facts is two different records with different
 * provenance, and collapsing them would hide which one the numbers came
 * from.
 */
function dedupe(foods: readonly Food[]): Food[] {
  const seen = new Set<string>();
  const merged: Food[] = [];

  for (const food of foods) {
    const key = `${food.source}:${food.sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(food);
  }

  return merged;
}

/** A short note for the UI when a source was unavailable. */
export function describeDegradation(results: readonly ProviderResult[]): string | null {
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) return null;

  const names = failed.map((r) =>
    r.source === "cache"
      ? "your saved foods"
      : r.source === "usda"
        ? "USDA"
        : "Open Food Facts",
  );

  return `${names.join(" and ")} did not respond, so these results may be incomplete.`;
}

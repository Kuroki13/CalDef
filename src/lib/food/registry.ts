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

import { cacheFood, searchCache } from "@/lib/food/cache";
import { offProvider } from "@/lib/food/off";
import { usdaProvider } from "@/lib/food/usda";
import { safeProviderCall } from "@/lib/food/provider";
import { searchRestaurantCatalogue } from "@/lib/food/restaurant-catalogue";
import type {
  Food,
  FoodSearchQuery,
  ProviderResult,
  SearchOutcome,
} from "@/lib/food/types";

export const PROVIDERS = [usdaProvider, offProvider];

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
  const cacheResult = await safeProviderCall("cache", () => searchCache(query));

  const providerResults = await Promise.all(
    PROVIDERS.map((provider) => provider.search(query)),
  );

  const results = [cacheResult, ...providerResults];
  const references = searchRestaurantCatalogue(query.text);
  const foods = dedupe([
    ...references,
    ...rank(dedupe(results.flatMap((r) => r.foods)), query.text),
  ]);

  return {
    foods,
    results,
    degraded: results.some((r) => !r.ok),
  };
}

/**
 * Orders merged results by how well they match what was typed.
 *
 * Without this the order is the fan-out's order — cache, then USDA, then
 * Open Food Facts — so a generic USDA row always outranked the branded
 * product the user actually meant. "Dubai chocolate" returned "Beverages,
 * chocolate syrup" as its top match, because USDA answers first and matched
 * one word of two. The first result is the one the AI path proposes and the
 * one a hurried user taps, so its order is not cosmetic.
 *
 * The sort is stable, so equally relevant foods keep the fan-out's order and
 * cache hits still come first among them — they are foods this user has
 * actually eaten, which is the better tie-break.
 */
function rank(foods: readonly Food[], text: string): Food[] {
  const scored = foods.map((food, index) => ({
    food,
    index,
    score: relevance(food, text),
  }));

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((s) => s.food);
}

/**
 * How much of the query this food's name and brand account for.
 *
 * Every matched term counts, and matching the whole phrase counts for more
 * again: a product literally called "Dubai chocolate" must beat one that
 * merely contains the word "chocolate". Nothing is filtered out on a low
 * score — a weak match is still a result the user can see and reject, and
 * dropping results would undo the degradation rule.
 */
function relevance(food: Food, text: string): number {
  const haystack = fold(`${food.name} ${food.brand ?? ""}`);
  const needle = fold(text);
  if (needle.length === 0) return 0;

  const terms = needle.split(" ").filter((t) => t.length > 0);
  if (terms.length === 0) return 0;

  const matched = terms.filter((term) => haystack.includes(term)).length;
  const phraseBonus = haystack.includes(needle) ? 0.5 : 0;

  return matched / terms.length + phraseBonus;
}

/**
 * Lowercased, accent-folded, punctuation reduced to spaces.
 *
 * Provider names are punctuated in ways nobody types ("Chicken, breast,
 * boneless") and the branded data is multilingual — the French entries for
 * Dubai chocolate spell it "Dubaï".
 */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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
  if (cached) return cached;

  if (!offProvider.lookupBarcode) return null;

  const found = await offProvider.lookupBarcode(barcode);
  if (!found) return null;

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

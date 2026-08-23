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
  const foods = dedupe(results.flatMap((r) => r.foods));

  return {
    foods,
    results,
    degraded: results.some((r) => !r.ok),
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
  if (cached) return cached;

  if (!offProvider.lookupBarcode) return null;

  const found = await offProvider.lookupBarcode(barcode);
  if (!found) return null;

  await cacheFood(found);
  return found;
}

/**
 * Persists a chosen search result and hands back its database id.
 *
 * Called when the user actually logs a food rather than on every search, so
 * the cache fills with foods this user eats instead of everything they ever
 * typed.
 */
export async function resolveToCachedId(food: Food): Promise<number> {
  return cacheFood(food);
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

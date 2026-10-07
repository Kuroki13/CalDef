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

import { cacheFood, refreshCachedFood, searchCache } from "@/lib/food/cache";
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
  const [cacheResult, history] = await Promise.all([
    safeProviderCall("cache", () => searchCache(query)),
    personalSignals(),
  ]);

  const providerResults = await Promise.all(
    PROVIDERS.map((provider) => provider.search(query)),
  );

  const results = [cacheResult, ...providerResults];

  // The providers have just answered anyway, so a cached row that has gone
  // stale can be brought up to date for nothing. Awaited rather than left
  // running: a serverless function that returns may be frozen mid-write.
  const refreshed = await refreshStaleHits(
    cacheResult.foods as CachedFood[],
    providerResults.flatMap((result) => result.foods),
  );

  const references = searchRestaurantCatalogue(query.text);
  const foods = dedupe([
    ...references,
    ...rank(
      dedupe([...refreshed, ...results.flatMap((r) => r.foods)]),
      query.text,
      history,
    ),
  ]);

  return {
    foods,
    results,
    degraded: results.some((r) => !r.ok),
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
): Food[] {
  return rankFoods(foods, text, signals);
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

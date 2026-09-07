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
import { loggedFoodCounts } from "@/lib/food/history";
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
    loggedFoodCounts(),
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
 * Orders merged results by how well they match what was typed.
 *
 * Without this the order is the fan-out's order — cache, then USDA, then
 * Open Food Facts — so a generic USDA row always outranked the branded
 * product the user actually meant. "Dubai chocolate" returned "Beverages,
 * chocolate syrup" as its top match, because USDA answers first and matched
 * one word of two. The first result is the one the AI path proposes and the
 * one a hurried user taps, so its order is not cosmetic.
 *
 * Relevance cannot settle a single word: every chicken row matches
 * "chicken" exactly as well as every other, so the fan-out order used to
 * decide and USDA's "Chicken spread" could lead. The user's own diary
 * breaks that tie — a food they have logged before is nearly always the one
 * they mean. It is a tie-break and not a term in the score, deliberately: a
 * food eaten weekly must not outrank an exact match on what was typed just
 * because it is familiar.
 *
 * The sort is stable, so foods equal on both still keep the fan-out's order,
 * and cache hits come first among them.
 */
function rank(
  foods: readonly Food[],
  text: string,
  history: ReadonlyMap<number, number> = new Map(),
): Food[] {
  const scored = foods.map((food, index) => ({
    food,
    index,
    score: relevance(food, text),
    familiarity: familiarityOf(food, history),
  }));

  scored.sort(
    (a, b) =>
      b.score - a.score || b.familiarity - a.familiarity || a.index - b.index,
  );
  return scored.map((s) => s.food);
}

/**
 * How often this user has logged this food.
 *
 * Zero for anything that is not a cached row, which is the honest answer:
 * a food that has never been in the cache has never been in the diary
 * either, because logging is what puts it there.
 */
function familiarityOf(
  food: Food,
  history: ReadonlyMap<number, number>,
): number {
  const id = (food as { id?: number }).id;
  return typeof id === "number" ? (history.get(id) ?? 0) : 0;
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

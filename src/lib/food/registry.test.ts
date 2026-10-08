import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Food, ProviderResult } from "@/lib/food/types";

const searchCache = vi.fn();
const findCachedByBarcode = vi.fn();
const cacheFood = vi.fn();
const refreshCachedFood = vi.fn();
const loggedFoodCounts = vi.fn();
const usdaSearch = vi.fn();
const offSearch = vi.fn();
const offLookupBarcode = vi.fn();
const ownFoodsNamingDish = vi.fn();
const listRecipeNames = vi.fn();
const getRecipe = vi.fn();

vi.mock("@/lib/recipes", () => ({
  listRecipeNames: () => listRecipeNames(),
  getRecipe: (id: number) => getRecipe(id),
}));

vi.mock("@/lib/food/cache", () => ({
  searchCache: (...a: unknown[]) => searchCache(...a),
  findCachedByBarcode: (...a: unknown[]) => findCachedByBarcode(...a),
  cacheFood: (...a: unknown[]) => cacheFood(...a),
  refreshCachedFood: (...a: unknown[]) => refreshCachedFood(...a),
  ownFoodsNamingDish: (...a: unknown[]) => ownFoodsNamingDish(...a),
}));

// The tests below speak in counts; the registry now takes the full
// signals, so counts become uses with no recency and no favourites — the
// same information the old tie-break had, and nothing more.
vi.mock("@/lib/food/history", () => ({
  personalSignals: async () => {
    const counts: Map<number, number> = await loggedFoodCounts();
    return {
      uses: new Map(
        [...counts].map(([id, count]) => [
          id,
          { count, lastLoggedAt: "2000-01-01T00:00:00Z" },
        ]),
      ),
      favorites: new Set(),
      now: new Date(),
    };
  },
}));

vi.mock("@/lib/food/usda", () => ({
  usdaProvider: {
    name: "USDA",
    isAvailable: () => true,
    search: (...a: unknown[]) => usdaSearch(...a),
  },
}));

vi.mock("@/lib/food/off", () => ({
  offProvider: {
    name: "OFF",
    isAvailable: () => true,
    search: (...a: unknown[]) => offSearch(...a),
    lookupBarcode: (...a: unknown[]) => offLookupBarcode(...a),
  },
}));

const { describeDegradation, lookupBarcode, searchFoods } = await import(
  "@/lib/food/registry"
);

const food = (source: Food["source"], sourceId: string, name = "Food"): Food => ({
  sourceId,
  source,
  name,
  brand: null,
  description: null,
  barcode: null,
  isVerified: false,
  nutrients: { kcal: 100, protein_g: 5, carbs_g: 10, fat_g: 2 },
  servings: [{ label: "100 g", grams: 100, isDefault: true }],
  dataUpdatedAt: null,
});

const ok = (source: ProviderResult["source"], foods: Food[]): ProviderResult => ({
  source,
  ok: true,
  foods,
});

const failed = (source: ProviderResult["source"]): ProviderResult => ({
  source,
  ok: false,
  foods: [],
  error: "The provider could not be reached.",
});

beforeEach(() => {
  vi.clearAllMocks();
  searchCache.mockResolvedValue([]);
  ownFoodsNamingDish.mockResolvedValue([]);
  listRecipeNames.mockResolvedValue([]);
  getRecipe.mockResolvedValue(null);
  loggedFoodCounts.mockResolvedValue(new Map());
  usdaSearch.mockResolvedValue(ok("usda", []));
  offSearch.mockResolvedValue(ok("off", []));
});

describe("searchFoods", () => {
  it("merges every source", async () => {
    searchCache.mockResolvedValue([food("custom", "c1", "Saved")]);
    usdaSearch.mockResolvedValue(ok("usda", [food("usda", "u1", "Chicken")]));
    offSearch.mockResolvedValue(ok("off", [food("off", "o1", "Nutella")]));

    const outcome = await searchFoods({ text: "x" });

    expect(outcome.foods).toHaveLength(3);
    expect(outcome.degraded).toBe(false);
  });

  it("lists cache hits first", async () => {
    searchCache.mockResolvedValue([food("custom", "c1", "Saved")]);
    usdaSearch.mockResolvedValue(ok("usda", [food("usda", "u1")]));

    const outcome = await searchFoods({ text: "x" });
    expect(outcome.foods[0].name).toBe("Saved");
  });

  it("keeps the same food from two providers as two records", async () => {
    // Same food, different provenance — collapsing them would hide which
    // source the numbers came from.
    usdaSearch.mockResolvedValue(ok("usda", [food("usda", "1", "Rice")]));
    offSearch.mockResolvedValue(ok("off", [food("off", "1", "Rice")]));

    const outcome = await searchFoods({ text: "rice" });
    expect(outcome.foods).toHaveLength(2);
  });

  it("deduplicates a repeated record from one source", async () => {
    usdaSearch.mockResolvedValue(
      ok("usda", [food("usda", "1"), food("usda", "1")]),
    );

    const outcome = await searchFoods({ text: "x" });
    expect(outcome.foods).toHaveLength(1);
  });
});

describe("searchFoods — relevance ordering", () => {
  it("puts the product that names the query above a partial match", async () => {
    // The real case: USDA answers before Open Food Facts in the fan-out, so
    // without ranking "Dubai chocolate" returned chocolate syrup.
    usdaSearch.mockResolvedValue(
      ok("usda", [food("usda", "u1", "Beverages, chocolate syrup")]),
    );
    offSearch.mockResolvedValue(
      ok("off", [food("off", "o1", "Dubai chocolate")]),
    );

    const outcome = await searchFoods({ text: "dubai chocolate" });

    expect(outcome.foods[0].name).toBe("Dubai chocolate");
  });

  it("folds accents, because the branded data is multilingual", async () => {
    offSearch.mockResolvedValue(
      ok("off", [
        food("off", "o1", "Chocolat au lait"),
        food("off", "o2", "Chocolat Dubaï pistache"),
      ]),
    );

    const outcome = await searchFoods({ text: "dubai chocolate" });
    expect(outcome.foods[0].name).toBe("Chocolat Dubaï pistache");
  });

  it("matches across the provider's punctuation", async () => {
    usdaSearch.mockResolvedValue(
      ok("usda", [
        food("usda", "u1", "Chicken, liver, raw"),
        food("usda", "u2", "Chicken, breast, boneless, skinless, raw"),
      ]),
    );

    const outcome = await searchFoods({ text: "chicken breast" });
    expect(outcome.foods[0].name).toContain("breast");
  });

  it("counts the brand as well as the name", async () => {
    offSearch.mockResolvedValue(
      ok("off", [
        { ...food("off", "o1", "Chocolate bar"), brand: "Generic" },
        { ...food("off", "o2", "Chocolate bar"), brand: "Lindt" },
      ]),
    );

    const outcome = await searchFoods({ text: "lindt chocolate" });
    expect(outcome.foods[0].brand).toBe("Lindt");
  });

  it("keeps a weak match rather than dropping it", async () => {
    usdaSearch.mockResolvedValue(ok("usda", [food("usda", "u1", "Rice")]));

    const outcome = await searchFoods({ text: "dubai chocolate" });

    // A weak match is a result the user can see and reject; dropping it
    // would undo the rule that a partial answer beats no answer.
    expect(outcome.foods).toHaveLength(1);
  });

  it("leaves equally relevant foods in fan-out order, cache first", async () => {
    searchCache.mockResolvedValue([food("custom", "c1", "Rice, saved")]);
    usdaSearch.mockResolvedValue(ok("usda", [food("usda", "u1", "Rice, raw")]));

    const outcome = await searchFoods({ text: "rice" });
    expect(outcome.foods[0].name).toBe("Rice, saved");
  });
});

describe("searchFoods — a dead provider degrades, it does not break", () => {
  it("still returns the other sources' results", async () => {
    usdaSearch.mockResolvedValue(failed("usda"));
    offSearch.mockResolvedValue(ok("off", [food("off", "o1", "Nutella")]));

    const outcome = await searchFoods({ text: "x" });

    expect(outcome.foods).toHaveLength(1);
    expect(outcome.foods[0].name).toBe("Nutella");
    expect(outcome.degraded).toBe(true);
  });

  it("survives the cache itself failing", async () => {
    searchCache.mockRejectedValue(new Error("database unreachable"));
    offSearch.mockResolvedValue(ok("off", [food("off", "o1")]));

    const outcome = await searchFoods({ text: "x" });

    expect(outcome.foods).toHaveLength(1);
    expect(outcome.degraded).toBe(true);
  });

  it("returns an empty, flagged result when everything fails", async () => {
    searchCache.mockRejectedValue(new Error("down"));
    usdaSearch.mockResolvedValue(failed("usda"));
    offSearch.mockResolvedValue(failed("off"));

    const outcome = await searchFoods({ text: "x" });

    expect(outcome.foods).toEqual([]);
    expect(outcome.degraded).toBe(true);
    // The point of the invariant: it resolved rather than threw.
  });

  it("queries providers concurrently rather than in series", async () => {
    const order: string[] = [];
    usdaSearch.mockImplementation(async () => {
      order.push("usda-start");
      await new Promise((r) => setTimeout(r, 20));
      order.push("usda-end");
      return ok("usda", []);
    });
    offSearch.mockImplementation(async () => {
      order.push("off-start");
      return ok("off", []);
    });

    await searchFoods({ text: "x" });
    expect(order.indexOf("off-start")).toBeLessThan(order.indexOf("usda-end"));
  });
});

describe("describeDegradation", () => {
  it("names the sources that failed", () => {
    const note = describeDegradation([ok("cache", []), failed("usda")]);
    expect(note).toContain("USDA");
    expect(note).toContain("incomplete");
  });

  it("returns null when everything answered", () => {
    expect(describeDegradation([ok("cache", []), ok("usda", [])])).toBeNull();
  });
});

describe("lookupBarcode", () => {
  const fresh = new Date().toISOString();
  const longAgo = new Date("2020-01-01T00:00:00Z").toISOString();

  it("returns a fresh cache hit without touching the network", async () => {
    findCachedByBarcode.mockResolvedValue({
      ...food("off", "1"),
      id: 7,
      refreshedAt: fresh,
    });

    const result = await lookupBarcode("3017624010701");

    expect(result?.sourceId).toBe("1");
    expect(offLookupBarcode).not.toHaveBeenCalled();
  });

  it("re-asks the provider when the cached row has expired", async () => {
    // A scanned product is exactly where a corrected figure matters, and the
    // request is one the cache was only ever deferring, not avoiding.
    findCachedByBarcode.mockResolvedValue({
      ...food("off", "1"),
      id: 7,
      refreshedAt: longAgo,
    });
    offLookupBarcode.mockResolvedValue(food("off", "1", "Nutella"));

    const result = await lookupBarcode("3017624010701");

    expect(offLookupBarcode).toHaveBeenCalledOnce();
    expect(refreshCachedFood).toHaveBeenCalledWith(7, expect.objectContaining({ name: "Nutella" }));
    expect(result?.name).toBe("Nutella");
  });

  it("keeps the stale copy when the provider cannot be reached", async () => {
    // Degrading, not failing: the copy we hold is better than nothing, and
    // the user asked about a packet in their hand.
    findCachedByBarcode.mockResolvedValue({
      ...food("off", "1", "Old Nutella"),
      id: 7,
      refreshedAt: longAgo,
    });
    offLookupBarcode.mockResolvedValue(null);

    const result = await lookupBarcode("3017624010701");

    expect(result?.name).toBe("Old Nutella");
    expect(refreshCachedFood).not.toHaveBeenCalled();
  });

  it("never re-asks a provider about the user's own food", async () => {
    findCachedByBarcode.mockResolvedValue({
      ...food("custom", "own-uuid", "My Flapjack"),
      id: 7,
      refreshedAt: longAgo,
    });

    const result = await lookupBarcode("3017624010701");

    expect(result?.name).toBe("My Flapjack");
    expect(offLookupBarcode).not.toHaveBeenCalled();
  });

  it("falls through to the provider and caches the result", async () => {
    findCachedByBarcode.mockResolvedValue(null);
    offLookupBarcode.mockResolvedValue(food("off", "3017624010701", "Nutella"));
    cacheFood.mockResolvedValue(42);

    const result = await lookupBarcode("3017624010701");

    expect(result?.name).toBe("Nutella");
    // Cached on the way out, so a second scan costs no request.
    expect(cacheFood).toHaveBeenCalledOnce();
  });

  it("returns null when the product is unknown, and caches nothing", async () => {
    findCachedByBarcode.mockResolvedValue(null);
    offLookupBarcode.mockResolvedValue(null);

    expect(await lookupBarcode("0000000000000")).toBeNull();
    expect(cacheFood).not.toHaveBeenCalled();
  });
});

describe("ranking a one-word query", () => {
  const fresh = new Date().toISOString();

  it("puts a food the user has logged before ahead of one they never have", async () => {
    // "chicken" matches every chicken row equally, so relevance cannot
    // separate them and the fan-out order used to decide — which is how
    // USDA's "Chicken spread" came to lead a search for chicken.
    searchCache.mockResolvedValue([
      { ...food("usda", "spread", "Chicken spread"), id: 1, refreshedAt: fresh },
      { ...food("usda", "breast", "Chicken breast"), id: 2, refreshedAt: fresh },
    ]);
    loggedFoodCounts.mockResolvedValue(new Map([[2, 12]]));

    const outcome = await searchFoods({ text: "chicken" });

    expect(outcome.foods[0].name).toBe("Chicken breast");
  });

  it("prefers the food logged more often when both are familiar", async () => {
    searchCache.mockResolvedValue([
      { ...food("usda", "a", "Chicken thigh"), id: 1, refreshedAt: fresh },
      { ...food("usda", "b", "Chicken breast"), id: 2, refreshedAt: fresh },
    ]);
    loggedFoodCounts.mockResolvedValue(new Map([[1, 2], [2, 30]]));

    const outcome = await searchFoods({ text: "chicken" });

    expect(outcome.foods[0].name).toBe("Chicken breast");
  });

  it("does not let familiarity beat a better match on what was typed", async () => {
    // The tie-break is a tie-break. A food eaten weekly must not outrank an
    // exact match on the phrase the user actually typed.
    searchCache.mockResolvedValue([
      { ...food("usda", "a", "Chicken breast"), id: 1, refreshedAt: fresh },
    ]);
    usdaSearch.mockResolvedValue(
      ok("usda", [food("usda", "b", "Dubai chocolate")]),
    );
    loggedFoodCounts.mockResolvedValue(new Map([[1, 50]]));

    const outcome = await searchFoods({ text: "dubai chocolate" });

    expect(outcome.foods[0].name).toBe("Dubai chocolate");
  });

  it("keeps the old order when nothing has been logged", async () => {
    searchCache.mockResolvedValue([
      { ...food("usda", "a", "Chicken spread"), id: 1, refreshedAt: fresh },
      { ...food("usda", "b", "Chicken breast"), id: 2, refreshedAt: fresh },
    ]);
    loggedFoodCounts.mockResolvedValue(new Map());

    const outcome = await searchFoods({ text: "chicken" });

    expect(outcome.foods.map((f) => f.name)).toEqual([
      "Chicken spread",
      "Chicken breast",
    ]);
  });

  it("ranks a search normally when the history cannot be read", async () => {
    // Not knowing what someone has eaten is a reason to rank slightly worse,
    // never a reason to fail the search.
    searchCache.mockResolvedValue([
      { ...food("usda", "a", "Chicken breast"), id: 1, refreshedAt: fresh },
    ]);
    loggedFoodCounts.mockResolvedValue(new Map());

    const outcome = await searchFoods({ text: "chicken" });

    expect(outcome.foods).toHaveLength(1);
    expect(outcome.degraded).toBe(false);
  });
});

describe("searchFoods — a dish in any spelling (§13A)", () => {
  const fresh = new Date().toISOString();

  it("asks the providers for the dish by its database name, not the spelling typed", async () => {
    await searchFoods({ text: "7ummus" });
    expect(usdaSearch).toHaveBeenCalledWith(expect.objectContaining({ text: "hummus" }));
    expect(offSearch).toHaveBeenCalledWith(expect.objectContaining({ text: "hummus" }));
  });

  it("carries the variant into the search: ma2loubeh djej is chicken maqluba", async () => {
    const outcome = await searchFoods({ text: "ma2loubeh djej" });
    expect(usdaSearch).toHaveBeenCalledWith(expect.objectContaining({ text: "chicken maqluba" }));
    expect(outcome.recognised).toMatchObject({
      id: "maqluba",
      arabic: "مقلوبة",
      variant: { id: "chicken" },
      variantOpen: false,
    });
  });

  it("puts the user's own food first when it names the dish in their spelling", async () => {
    ownFoodsNamingDish.mockResolvedValue([
      { ...food("custom", "mom", "Mom's Maqlouba"), id: 9, refreshedAt: fresh },
    ]);
    usdaSearch.mockResolvedValue(ok("usda", [food("usda", "r", "Rice, white, cooked")]));

    const outcome = await searchFoods({ text: "ma2loubeh" });

    expect(ownFoodsNamingDish).toHaveBeenCalledWith("maqluba");
    expect(outcome.foods[0].name).toBe("Mom's Maqlouba");
    expect(outcome.strongMatch).toBe(true);
    // Her maqlouba is which kind; asking would be interrogation (§13E).
    expect(outcome.recognised?.variantOpen).toBe(false);
  });

  it("says the question is open when the variant matters and was not given", async () => {
    const outcome = await searchFoods({ text: "warak enab" });
    expect(outcome.recognised?.variantOpen).toBe(true);
    expect(outcome.recognised?.variants.map((v) => v.id)).toEqual(["meat", "vegetarian"]);
    expect(outcome.strongMatch).toBe(false);
  });

  it("leaves an ordinary search exactly as it was", async () => {
    const outcome = await searchFoods({ text: "chicken breast" });
    expect(usdaSearch).toHaveBeenCalledWith(expect.objectContaining({ text: "chicken breast" }));
    expect(ownFoodsNamingDish).not.toHaveBeenCalled();
    expect(outcome.recognised).toBeNull();
  });
});

describe("searchFoods — the user's own recipes (§13G)", () => {
  const detail = (id: number, name: string, ingredients = 3) => ({
    recipe: { id, name, servings: 6 },
    ingredients: Array.from({ length: ingredients }, (_, i) => ({ id: i })),
    perServing: { kcal: 540, protein_g: 28, carbs_g: 60, fat_g: 18 },
  });

  it("offers the family recipe for any spelling of the dish, and asks nothing", async () => {
    listRecipeNames.mockResolvedValue([
      { id: 7, name: "Mom's Chicken Maqlouba" },
      { id: 8, name: "Lentil soup" },
    ]);
    getRecipe.mockImplementation(async (id: number) => (id === 7 ? detail(7, "Mom's Chicken Maqlouba") : null));

    const outcome = await searchFoods({ text: "ma2loubeh" });

    expect(outcome.recipes).toEqual([
      { id: 7, name: "Mom's Chicken Maqlouba", servings: 6, kcalPerServing: 540, proteinPerServing: 28 },
    ]);
    expect(getRecipe).toHaveBeenCalledTimes(1);
    expect(outcome.strongMatch).toBe(true);
    expect(outcome.recognised?.variantOpen).toBe(false);
  });

  it("does not offer a recipe with nothing in it", async () => {
    listRecipeNames.mockResolvedValue([{ id: 9, name: "Maqlouba idea" }]);
    getRecipe.mockResolvedValue(detail(9, "Maqlouba idea", 0));
    expect((await searchFoods({ text: "maqlouba" })).recipes).toEqual([]);
  });

  it("still searches when the recipe book cannot be read", async () => {
    listRecipeNames.mockRejectedValue(new Error("down"));
    usdaSearch.mockResolvedValue(ok("usda", [food("usda", "h", "Hummus, commercial")]));
    const outcome = await searchFoods({ text: "hummus" });
    expect(outcome.recipes).toEqual([]);
    expect(outcome.foods).toHaveLength(1);
  });
});

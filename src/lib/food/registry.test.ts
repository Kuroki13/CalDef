import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Food, ProviderResult } from "@/lib/food/types";

const searchCache = vi.fn();
const findCachedByBarcode = vi.fn();
const cacheFood = vi.fn();
const usdaSearch = vi.fn();
const offSearch = vi.fn();
const offLookupBarcode = vi.fn();

vi.mock("@/lib/food/cache", () => ({
  searchCache: (...a: unknown[]) => searchCache(...a),
  findCachedByBarcode: (...a: unknown[]) => findCachedByBarcode(...a),
  cacheFood: (...a: unknown[]) => cacheFood(...a),
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
  it("returns a cache hit without touching the network", async () => {
    findCachedByBarcode.mockResolvedValue({ ...food("off", "1"), id: 7 });

    const result = await lookupBarcode("3017624010701");

    expect(result?.sourceId).toBe("1");
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

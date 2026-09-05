/**
 * Live provider checks.
 *
 * Excluded from `npm run test` because it makes real network calls: a unit
 * suite that fails when a third party is down is a suite people learn to
 * ignore. Run it deliberately with `npm run test:live` after touching a
 * provider, to confirm the mapping still matches what the API actually
 * returns — which mocked fixtures cannot tell you.
 */

import { describe, expect, it } from "vitest";

import { offProvider } from "@/lib/food/off";
import { usdaProvider } from "@/lib/food/usda";
import { isNutrientRowPlausible } from "@/lib/nutrition/macros";

describe("USDA, live", () => {
  it("returns usable generic foods for a common query", async () => {
    const result = await usdaProvider.search({ text: "chicken breast", limit: 10 });

    // Distinguish "our mapping is wrong" from "the provider is down". Both
    // fail this suite, but only one of them is a bug in this repo.
    expect(
      result.ok,
      `USDA was unreachable (${result.error}). If this is the only failure, ` +
        "the provider is down rather than the mapping being wrong — the app " +
        "degrades correctly in that case, which registry.test.ts covers.",
    ).toBe(true);

    expect(result.foods.length).toBeGreaterThan(0);

    for (const food of result.foods) {
      expect(food.source).toBe("usda");
      expect(food.name.length).toBeGreaterThan(0);
      expect(food.nutrients.kcal).toBeGreaterThan(0);
      expect(food.servings.length).toBeGreaterThan(0);
    }
  }, 20_000);

  it("returns nutrient rows whose calories match their macros", async () => {
    const result = await usdaProvider.search({ text: "white rice", limit: 10 });
    if (!result.ok) return; // Covered by the reachability assertion above.

    const implausible = result.foods.filter(
      (f) => !isNutrientRowPlausible(f.nutrients),
    );

    // Laboratory-analysed data should be internally consistent.
    expect(implausible.map((f) => f.name)).toEqual([]);
  }, 20_000);
});

describe("Open Food Facts, live", () => {
  it("resolves a known barcode", async () => {
    const food = await offProvider.lookupBarcode!("3017624010701");

    expect(food).not.toBeNull();
    expect(food!.source).toBe("off");
    expect(food!.barcode).toBe("3017624010701");
    expect(food!.nutrients.kcal).toBeGreaterThan(0);
    expect(food!.isVerified).toBe(false);
  }, 20_000);

  it("returns null for a barcode that does not exist", async () => {
    expect(await offProvider.lookupBarcode!("0000000000017")).toBeNull();
  }, 20_000);

  it("searches branded products", async () => {
    const result = await offProvider.search({ text: "nutella", limit: 5 });

    // Open Food Facts' search backend is frequently overloaded and answers
    // 503 while the product endpoint above stays healthy. That is an upstream
    // condition, not a mapping fault.
    expect(
      result.ok,
      `Open Food Facts search was unreachable (${result.error}). The barcode ` +
        "test above uses a different endpoint and is the better signal for " +
        "whether the mapping is correct.",
    ).toBe(true);

    expect(result.foods.length).toBeGreaterThan(0);

    // Zero-calorie products are real (water, diet drinks), so the floor is
    // zero rather than one — but a whole page of them would mean the energy
    // field is not being read at all.
    for (const food of result.foods) {
      expect(food.nutrients.kcal).toBeGreaterThanOrEqual(0);
    }
    expect(result.foods.some((f) => f.nutrients.kcal > 0)).toBe(true);
  }, 20_000);

  /**
   * Regression: search once returned products matched to nothing the user
   * typed — "dubai" produced Moroccan bottled water and yoghurt — because
   * the v2 endpoint ignores `search_terms` rather than rejecting it. Nothing
   * in a mocked suite can catch that, since the mock returns whatever it is
   * handed regardless of the URL.
   *
   * The assertion is deliberately one-sided. Zero results is a legitimate
   * answer; results unrelated to the query are not, because they look like
   * real answers and get logged as food.
   */
  it("returns products matching the query, or none at all", async () => {
    const result = await offProvider.search({ text: "dubai", limit: 10 });
    if (!result.ok) return; // Upstream outage; the assertion above covers it.

    // Accent-folded, because the products that match are largely French and
    // German and spell it "Dubaï".
    const fold = (s: string) =>
      s
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase();

    const unrelated = result.foods.filter(
      (f) => !fold(`${f.name} ${f.brand ?? ""}`).includes("dubai"),
    );

    expect(
      unrelated.map((f) => f.name),
      "Open Food Facts returned products unrelated to the search term. " +
        "Check that the search endpoint still honours `search_terms`.",
    ).toEqual([]);
  }, 20_000);
});

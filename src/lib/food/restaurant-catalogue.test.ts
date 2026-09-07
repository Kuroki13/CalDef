import { describe, expect, it } from "vitest";
import { restaurantById, restaurantReference, searchRestaurantCatalogue } from "./restaurant-catalogue";
import { scaleNutrients } from "@/lib/nutrition/macros";

describe("reviewed restaurant references", () => {
  it("matches the user's Big Angus wording and scales the published serving", () => {
    const foods = searchRestaurantCatalogue("Harvey's big angus burger");
    expect(foods).toHaveLength(1);
    expect(foods[0].name).toBe("Big Harv (Angus)");
    const macros = scaleNutrients(foods[0].nutrients, foods[0].servings[0].grams);
    expect(macros.kcal).toBeCloseTo(750, 0);
    expect(macros.protein_g).toBeCloseTo(36, 0);
    expect(macros.carbs_g).toBeCloseTo(39, 0);
    expect(macros.fat_g).toBeCloseTo(50, 0);
    expect(restaurantReference(foods[0])).toEqual({ url: "https://www.harveys.ca/en/nutrition.html", reviewed: "2026-09-06", country: "Canada" });
    expect(foods[0].isVerified).toBe(false);
    expect(foods[0].dataUpdatedAt).toBeNull();
  });
  it.each(["McDonald's Angus burger", "Harvey's Big Angus combo", "Harvey's Angus extra cheese", "Harvey's chicken nuggets"])("does not invent an unsupported menu variant: %s", (query) => {
    expect(searchRestaurantCatalogue(query)).toEqual([]);
  });
  it("keeps the regular burger and bacon variant distinct", () => {
    expect(searchRestaurantCatalogue("Harveys Angus Burger")[0].name).toBe("Angus Burger");
    expect(searchRestaurantCatalogue("Harvey’s Angus cheese bacon")[0].servings[0].grams).toBe(187);
    expect(restaurantById("restaurant:harveys:fake")).toBeNull();
    expect(restaurantReference({ description: null })).toBeNull();
  });
});

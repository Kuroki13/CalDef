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

describe("Subway, A&W and Five Guys — official Canadian data (§13L)", () => {
  const kcalPerServing = (food: ReturnType<typeof searchRestaurantCatalogue>[number]) =>
    scaleNutrients(food.nutrients, food.servings[0].grams).kcal;

  it("tells a 6-inch sub from the wrap and salad of the same name", () => {
    const names = searchRestaurantCatalogue("subway italian bmt").map((f) => f.name);
    expect(names).toContain('Italian B.M.T. — 6" sub');
    expect(names).toContain("Italian B.M.T. — wrap");
    expect(names).toContain("Italian B.M.T. — salad");
  });

  it("gives the published 6-inch figures, and reads 'footlong' as no extra word", () => {
    const [sub] = searchRestaurantCatalogue("subway footlong italian bmt sub");
    expect(sub.name).toBe('Italian B.M.T. — 6" sub');
    expect(sub.servings[0]).toEqual({ label: '1 6" sub (245 g)', grams: 245, isDefault: true });
    expect(kcalPerServing(sub)).toBeCloseTo(560, 0);
  });

  it("finds the Teen Burger at A&W however the chain is written", () => {
    for (const q of ["A&W teen burger", "a and w teen burger", "teen burger a&w"]) {
      const [first] = searchRestaurantCatalogue(q);
      expect(first?.name, q).toBe("Teen Burger");
      expect(kcalPerServing(first)).toBeCloseTo(500, 0);
    }
  });

  it("offers Five Guys components and add-ons as the official parts they are", () => {
    const [patty] = searchRestaurantCatalogue("five guys patty");
    expect(patty.servings[0].grams).toBe(65);
    expect(kcalPerServing(patty)).toBeCloseTo(302, 0);
    expect(searchRestaurantCatalogue("5 guys bacon")[0].name).toBe("Bacon (2 pieces)");
  });

  it("leaves out the published row that cannot be true, rather than correcting it", () => {
    expect(searchRestaurantCatalogue("five guys chocolate")).toEqual([]);
  });

  it("still refuses what is not on the sheet", () => {
    // ("subway combo" is not one of these: Subway sells a Cold Cut Combo.)
    expect(searchRestaurantCatalogue("subway chicken nuggets")).toEqual([]);
    expect(searchRestaurantCatalogue("five guys cheeseburger")).toEqual([]);
  });

  it("round-trips an identity and names its source", () => {
    const [teen] = searchRestaurantCatalogue("A&W teen burger");
    expect(restaurantById(teen.sourceId)?.name).toBe("Teen Burger");
    expect(restaurantReference(teen)).toEqual({
      url: "https://web.aw.ca/api/menu/",
      reviewed: "2026-10-08",
      country: "Canada",
    });
  });
});

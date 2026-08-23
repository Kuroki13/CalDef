import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const { __searchTerms, rowToFood } = await import("@/lib/food/cache");

describe("searchTerms", () => {
  it("splits on whitespace", () => {
    expect(__searchTerms("chicken breast")).toEqual(["chicken", "breast"]);
  });

  it("splits on commas, which provider names are full of", () => {
    // USDA: "Chicken, breast, boneless, skinless, raw"
    expect(__searchTerms("boneless, skinless")).toEqual([
      "boneless",
      "skinless",
    ]);
  });

  it("collapses repeated separators", () => {
    expect(__searchTerms("chicken,,   breast")).toEqual(["chicken", "breast"]);
  });

  it("strips ilike wildcards so a typed % is not a pattern", () => {
    expect(__searchTerms("100% beef")).toEqual(["100", "beef"]);
    expect(__searchTerms("a_b")).toEqual(["ab"]);
  });

  it("drops a term that was only wildcards", () => {
    expect(__searchTerms("beef %")).toEqual(["beef"]);
  });

  it("returns nothing for an empty or whitespace query", () => {
    expect(__searchTerms("")).toEqual([]);
    expect(__searchTerms("   ,  ")).toEqual([]);
  });

  it("bounds the number of terms so one query cannot chain endlessly", () => {
    expect(__searchTerms("a b c d e f g h i j")).toHaveLength(6);
  });
});

describe("rowToFood", () => {
  const row = {
    id: 1,
    source: "usda",
    source_id: "171515",
    name: "Chicken breast",
    brand: null,
    description: null,
    barcode: null,
    is_verified: true,
    data_updated_at: null,
    food_nutrients: {
      kcal: 165,
      protein_g: 31,
      carbs_g: 0,
      fat_g: 3.6,
      fiber_g: null,
      sugar_g: null,
      sat_fat_g: null,
      sodium_mg: null,
    },
    food_servings: [{ label: "100 g", grams: 100, is_default: true }],
  };

  it("maps a row to the neutral shape with its database id", () => {
    const [food] = rowToFood(row);
    expect(food.id).toBe(1);
    expect(food.sourceId).toBe("171515");
    expect(food.servings[0].isDefault).toBe(true);
  });

  it("drops a food with no nutrient row rather than defaulting to zero", () => {
    // A zero-calorie entry that silently logs nothing is worse than absent.
    expect(rowToFood({ ...row, food_nutrients: null })).toEqual([]);
  });

  it("tolerates a food with no servings", () => {
    const [food] = rowToFood({ ...row, food_servings: [] });
    expect(food.servings).toEqual([]);
  });
});

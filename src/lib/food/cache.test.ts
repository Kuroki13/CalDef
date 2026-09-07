import { describe, expect, it, vi } from "vitest";

const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));

const { __searchTerms, cacheFood, rowToFood } = await import("@/lib/food/cache");

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

describe("cacheFood and the ownership boundary", () => {
  /** Just enough client for the one lookup the custom branch makes. */
  function clientReturning(row: { id: number } | null) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
          }),
        }),
      }),
    };
  }

  const customFood = {
    sourceId: "6f1c9d2e-0000-4000-8000-000000000000",
    source: "custom" as const,
    name: "Protein flapjack",
    brand: null,
    description: null,
    barcode: null,
    isVerified: false,
    nutrients: { kcal: 400, protein_g: 20, carbs_g: 45, fat_g: 12 },
    servings: [],
    dataUpdatedAt: null,
  };

  it("resolves one of the user's own custom foods to its row", async () => {
    createClient.mockResolvedValue(clientReturning({ id: 42 }));
    await expect(cacheFood(customFood)).resolves.toBe(42);
  });

  it("refuses to create a custom food, which would have no owner", async () => {
    // This function writes `user_id` nowhere. An insert from here would
    // either break `foods_custom_requires_owner` or — if the constraint
    // were ever relaxed — quietly make an ownerless copy of somebody's
    // private food. RLS also hides another user's row, so a payload naming
    // one arrives here as "not found" and stops.
    createClient.mockResolvedValue(clientReturning(null));

    await expect(cacheFood(customFood)).rejects.toThrow(
      /only be created by its owner/,
    );
  });
});

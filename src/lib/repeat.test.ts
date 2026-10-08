import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.fn();
const logCachedFood = vi.fn();
const logRecipe = vi.fn();

const inserted = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  requireUserId: async () => "user-a",
  createClient: async () => ({
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        in: async () => rows(),
        insert: async (row: unknown) => {
          inserted(row);
          return { error: null };
        },
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/food-log", () => ({ logCachedFood: (i: unknown) => logCachedFood(i) }));
vi.mock("@/lib/recipes", () => ({
  logRecipe: (...a: unknown[]) => logRecipe(...a),
}));

const { repeatEntries, MAX_REPEAT_ITEMS } = await import("@/lib/repeat");

const yogurt = {
  id: 11, food_id: 5, recipe_id: null, unit: "serving", notes: null,
  // The old row's figures are not even selected: nothing to carry forward.
  foods: { name: "Protein yogurt" }, food_servings: { label: "1 pot" },
};
const stew = {
  id: 12, food_id: null, recipe_id: 9, unit: "serving", notes: "Lentil stew",
  foods: null, food_servings: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  rows.mockResolvedValue({ data: [yogurt, stew], error: null });
  logCachedFood.mockResolvedValue({ ok: true });
  logRecipe.mockResolvedValue({ ok: true });
});

const target = { logDate: "2026-10-07", mealTypeId: 2 };

const dinner = {
  id: 13, food_id: null, recipe_id: null, unit: "serving", notes: "Dinner out",
  is_estimate: true, kcal: 750, protein_g: 45, carbs_g: 60, fat_g: 30,
  foods: null, food_servings: null,
};

describe("repeatEntries", () => {
  it("repeats a Quick Add as the user's own figures, still marked as an estimate", async () => {
    rows.mockResolvedValue({ data: [dinner], error: null });
    const outcome = await repeatEntries({ ...target, items: [{ entryId: 13, amount: 0.5 }] });

    expect(outcome).toEqual({ logged: 1, failed: [] });
    expect(logCachedFood).not.toHaveBeenCalled();
    expect(inserted).toHaveBeenCalledWith(
      expect.objectContaining({
        is_estimate: true,
        notes: "Dinner out",
        grams: null,
        kcal: 375,
        protein_g: 22.5,
        log_date: "2026-10-07",
        meal_type_id: 2,
      }),
    );
  });

  it("logs a food again through logCachedFood, with the new amount and the old serving", async () => {
    const outcome = await repeatEntries({ ...target, items: [{ entryId: 11, amount: 2 }] });

    expect(outcome).toEqual({ logged: 1, failed: [] });
    expect(logCachedFood).toHaveBeenCalledWith({
      foodId: 5,
      logDate: "2026-10-07",
      mealTypeId: 2,
      amount: 2,
      unit: "serving",
      servingLabel: "1 pot",
      source: "manual",
    });
  });

  it("logs a recipe again as servings of the recipe", async () => {
    await repeatEntries({ ...target, items: [{ entryId: 12, amount: 1.5 }] });
    expect(logRecipe).toHaveBeenCalledWith(9, "2026-10-07", 2, { amount: 1.5, unit: "serving" });
    expect(logCachedFood).not.toHaveBeenCalled();
  });

  it("repeats a weighed recipe in grams when it was logged in grams", async () => {
    rows.mockResolvedValue({ data: [{ ...stew, unit: "g" }], error: null });
    await repeatEntries({ ...target, items: [{ entryId: 12, amount: 450 }] });
    expect(logRecipe).toHaveBeenCalledWith(9, "2026-10-07", 2, { amount: 450, unit: "g" });
  });

  it("names what did not go in, and still logs the rest", async () => {
    logRecipe.mockResolvedValue({ error: "That recipe no longer exists." });
    const outcome = await repeatEntries({
      ...target,
      items: [{ entryId: 11, amount: 1 }, { entryId: 12, amount: 1 }, { entryId: 99, amount: 1 }],
    });
    expect(outcome).toEqual({
      logged: 1,
      failed: [
        { name: "Lentil stew", reason: "That recipe no longer exists." },
        { name: "An entry", reason: "It is no longer in your diary." },
      ],
    });
  });

  it("refuses an empty or oversized request before reading anything", async () => {
    expect(await repeatEntries({ ...target, items: [] })).toEqual({ error: "Choose at least one item." });
    const many = Array.from({ length: MAX_REPEAT_ITEMS + 1 }, (_, i) => ({ entryId: i + 1, amount: 1 }));
    expect("error" in (await repeatEntries({ ...target, items: many }))).toBe(true);
    expect(rows).not.toHaveBeenCalled();
  });
});

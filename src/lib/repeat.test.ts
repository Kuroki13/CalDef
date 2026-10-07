import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.fn();
const logCachedFood = vi.fn();
const logRecipe = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        in: async () => rows(),
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

describe("repeatEntries", () => {
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
    expect(logRecipe).toHaveBeenCalledWith(9, "2026-10-07", 2, 1.5);
    expect(logCachedFood).not.toHaveBeenCalled();
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

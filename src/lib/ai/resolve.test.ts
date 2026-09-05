import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Food, SearchOutcome } from "@/lib/food/types";

const searchFoods = vi.fn();

vi.mock("@/lib/food/registry", () => ({
  searchFoods: (...args: unknown[]) => searchFoods(...args),
}));

const { portionFor, resolveIntents } = await import("@/lib/ai/resolve");

function food(over: Partial<Food> = {}): Food {
  return {
    sourceId: "1",
    source: "usda",
    name: "Chicken breast, raw",
    brand: null,
    description: null,
    barcode: null,
    isVerified: true,
    nutrients: { kcal: 165, protein_g: 31, carbs_g: 0, fat_g: 3.6 },
    servings: [{ label: "100 g", grams: 100, isDefault: true }],
    dataUpdatedAt: null,
    ...over,
  };
}

const outcome = (foods: Food[], degraded = false): SearchOutcome => ({
  foods,
  results: [{ source: "usda", ok: !degraded, foods }],
  degraded,
});

beforeEach(() => {
  vi.clearAllMocks();
  searchFoods.mockResolvedValue(outcome([food()]));
});

describe("resolveIntents", () => {
  it("computes macros from the matched food, not from the model", async () => {
    const { proposals } = await resolveIntents([
      { query: "chicken breast", amount: 200, unit: "g" },
    ]);

    expect(proposals[0].grams).toBe(200);
    // 165 kcal/100 g × 200 g. The model was never asked and could not have
    // supplied this.
    expect(proposals[0].macros).toEqual({
      kcal: 330,
      protein_g: 62,
      carbs_g: 0,
      fat_g: 7.2,
    });
  });

  it("searches once per intent and keeps them in order", async () => {
    searchFoods
      .mockResolvedValueOnce(outcome([food({ name: "Chicken" })]))
      .mockResolvedValueOnce(outcome([food({ name: "Rice" })]));

    const { proposals } = await resolveIntents([
      { query: "chicken breast", amount: 200, unit: "g" },
      { query: "white rice", amount: 150, unit: "g" },
    ]);

    expect(searchFoods).toHaveBeenCalledTimes(2);
    expect(proposals.map((p) => p.match?.name)).toEqual(["Chicken", "Rice"]);
    expect(proposals.map((p) => p.intent.query)).toEqual([
      "chicken breast",
      "white rice",
    ]);
  });

  it("offers the runners-up so a wrong first guess is one click to fix", async () => {
    searchFoods.mockResolvedValue(
      outcome([
        food({ sourceId: "1", name: "Chicken breast, raw" }),
        food({ sourceId: "2", name: "Chicken breast, cooked" }),
        food({ sourceId: "3", name: "Chicken thigh" }),
      ]),
    );

    const { proposals } = await resolveIntents([
      { query: "chicken", amount: 100, unit: "g" },
    ]);

    expect(proposals[0].match?.name).toBe("Chicken breast, raw");
    expect(proposals[0].alternatives.map((f) => f.name)).toEqual([
      "Chicken breast, cooked",
      "Chicken thigh",
    ]);
  });

  it("returns a proposal with no match rather than dropping the food", async () => {
    searchFoods.mockResolvedValue(outcome([]));

    const { proposals } = await resolveIntents([
      { query: "gefilte something", amount: 1, unit: "serving" },
    ]);

    // The user needs to see that this item was understood but not found —
    // silently omitting it would look like it had been logged.
    expect(proposals).toHaveLength(1);
    expect(proposals[0].match).toBeNull();
    expect(proposals[0].macros).toBeNull();
    expect(proposals[0].intent.query).toBe("gefilte something");
  });

  it("reports degradation when a provider was down", async () => {
    searchFoods.mockResolvedValue(outcome([food()], true));
    const { degraded } = await resolveIntents([
      { query: "x", amount: 1, unit: "g" },
    ]);
    expect(degraded).toBe(true);
  });
});

describe("portionFor", () => {
  it("resolves a serving amount through the food's default serving", () => {
    const bar = food({
      nutrients: { kcal: 500, protein_g: 5, carbs_g: 60, fat_g: 25 },
      servings: [
        { label: "100 g", grams: 100, isDefault: false },
        { label: "1 bar (40 g)", grams: 40, isDefault: true },
      ],
    });

    const result = portionFor({ query: "bar", amount: 2, unit: "serving" }, bar);

    expect(result.grams).toBe(80);
    expect(result.macros?.kcal).toBe(400);
  });

  it("refuses a serving amount when the food has no serving", () => {
    const noServings = food({ servings: [] });
    const result = portionFor(
      { query: "x", amount: 1, unit: "serving" },
      noServings,
    );

    // Inventing a gram weight here would put a fabricated number in the
    // diary, which is the one thing the whole layer exists to prevent.
    expect(result.grams).toBeNull();
    expect(result.macros).toBeNull();
  });

  it("yields nothing when there is no food to measure against", () => {
    expect(portionFor({ query: "x", amount: 1, unit: "g" }, null)).toEqual({
      grams: null,
      macros: null,
    });
  });
});

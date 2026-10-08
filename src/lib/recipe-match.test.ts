import { describe, expect, it } from "vitest";

import { recognise } from "@/lib/food/cultural/recognise";
import { matchRecipes } from "@/lib/recipe-match";

const book = [
  { id: 1, name: "Lentil soup" },
  { id: 2, name: "Mom's Maqlouba (eggplant)" },
  { id: 3, name: "Mom's Chicken Maqlouba" },
  { id: 4, name: "Overnight oats" },
];

const dishOf = (query: string) => {
  const found = recognise(query)[0];
  return found ? { id: found.dish.id, variantId: found.variant?.id ?? null } : null;
};

const names = (query: string) => matchRecipes(book, query, dishOf(query)).map((r) => r.name);

describe("matchRecipes — §13G", () => {
  it("finds the family recipe under any spelling of the dish", () => {
    expect(names("ma2loubeh")).toEqual(["Mom's Maqlouba (eggplant)", "Mom's Chicken Maqlouba"]);
    expect(names("مقلوبة")).toHaveLength(2);
  });

  it("puts the variant asked for first, and the other variant last", () => {
    expect(names("maqlouba djej")).toEqual(["Mom's Chicken Maqlouba", "Mom's Maqlouba (eggplant)"]);
  });

  it("matches a recipe by its own words too", () => {
    expect(names("lentil")).toEqual(["Lentil soup"]);
  });

  it("finds nothing for an unrelated query", () => {
    expect(names("chicken breast")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";

import {
  NO_SIGNALS,
  type PersonalSignals,
  WEIGHTS,
  personalScore,
  rankFoods,
  textMatch,
} from "@/lib/food/personal-rank";
import type { CachedFood, Food } from "@/lib/food/types";

const NOW = new Date("2026-10-07T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const food = (name: string, over: Partial<CachedFood> = {}): CachedFood => ({
  id: Math.floor(Math.random() * 1e9),
  sourceId: name,
  source: "off",
  name,
  brand: null,
  description: null,
  barcode: null,
  isVerified: false,
  nutrients: { kcal: 100, protein_g: 10, carbs_g: 0, fat_g: 1 },
  servings: [],
  dataUpdatedAt: null,
  ...over,
});

const signals = (
  uses: [number, number, number][] = [],
  favorites: number[] = [],
): PersonalSignals => ({
  uses: new Map(uses.map(([id, count, ago]) => [id, { count, lastLoggedAt: daysAgo(ago) }])),
  favorites: new Set(favorites),
  now: NOW,
});

const names = (foods: Food[]) => foods.map((f) => f.name);

describe("textMatch", () => {
  it("measures word coverage and the intact phrase separately", () => {
    expect(textMatch({ name: "Chicken, broiler, breast", brand: null }, "chicken breast"))
      .toEqual({ coverage: 1, phrase: false });
    expect(textMatch({ name: "Chicken breast nuggets", brand: null }, "chicken breast"))
      .toEqual({ coverage: 1, phrase: true });
    expect(textMatch({ name: "Chicken spread", brand: null }, "chicken breast").coverage).toBe(0.5);
  });
});

describe("rankFoods — §12C", () => {
  it("puts the chicken breast logged 28 times above an obscure match (the spec's case)", () => {
    const mine = food("Chicken, broiler, breast, meat only", { id: 1, source: "usda", isVerified: true });
    const obscure = food("Chicken breast nuggets", { id: 2 });
    const ranked = rankFoods([obscure, mine], "chicken breast", signals([[1, 28, 2]]));
    expect(ranked[0]).toBe(mine);
  });

  it("does the same for a one-word query", () => {
    const mine = food("Chicken breast", { id: 1 });
    const spread = food("Chicken spread", { id: 2 });
    expect(rankFoods([spread, mine], "chicken", signals([[1, 28, 2]]))[0]).toBe(mine);
  });

  it("never lets history beat a food that matches more of what was typed", () => {
    const mine = food("Chicken breast", { id: 1, source: "custom" });
    const dubai = food("Dubai chocolate", { id: 2 });
    const half = food("Chocolate milk", { id: 3 });
    const all = signals([[1, 500, 0], [3, 500, 0]], [1, 3]);
    expect(names(rankFoods([mine, half, dubai], "dubai chocolate", all))).toEqual([
      "Dubai chocolate",
      "Chocolate milk",
      "Chicken breast",
    ]);
  });

  it("does not let a food eaten once outweigh the exact phrase", () => {
    const once = food("Chicken, roasted, breast", { id: 1 });
    const phrase = food("Chicken breast fillets", { id: 2 });
    expect(rankFoods([once, phrase], "chicken breast", signals([[1, 1, 1]]))[0]).toBe(phrase);
  });

  it("prefers the more recent of two equally frequent foods", () => {
    const old = food("Greek yogurt plain", { id: 1 });
    const fresh = food("Greek yogurt honey", { id: 2 });
    const ranked = rankFoods([old, fresh], "greek yogurt", signals([[1, 6, 90], [2, 6, 3]]));
    expect(ranked[0]).toBe(fresh);
  });

  it("lifts a favourite and the user's own food among equals", () => {
    const plain = food("Oat milk A", { id: 1 });
    const starred = food("Oat milk B", { id: 2 });
    const own = food("Oat milk C", { id: 3, source: "custom" });
    expect(names(rankFoods([plain, own, starred], "oat milk", signals([], [2])))).toEqual([
      "Oat milk B",
      "Oat milk C",
      "Oat milk A",
    ]);
  });

  it("keeps the incoming order with no history and equal text", () => {
    const a = food("Rice A");
    const b = food("Rice B");
    expect(rankFoods([a, b], "rice", NO_SIGNALS)).toEqual([a, b]);
  });

  it("gives verified data a small edge, smaller than any real habit", () => {
    const verified = food("Banana raw", { id: 1, source: "usda", isVerified: true });
    const community = food("Banana raw", { id: 2 });
    expect(rankFoods([community, verified], "banana", NO_SIGNALS)[0]).toBe(verified);
    expect(rankFoods([verified, community], "banana", signals([[2, 3, 2]]))[0]).toBe(community);
  });
});

describe("personalScore", () => {
  it("saturates, so the 500th log adds nothing over the 20th", () => {
    const f = food("x", { id: 1 });
    expect(personalScore(f, signals([[1, 500, 100]]))).toBeCloseTo(
      personalScore(f, signals([[1, 20, 100]])),
    );
    expect(personalScore(f, signals([[1, 20, 100]]))).toBeCloseTo(WEIGHTS.frequency);
  });

  it("is zero for a provider food never seen before", () => {
    const uncached: Food = { ...food("x") };
    delete (uncached as { id?: number }).id;
    expect(personalScore(uncached, signals([[1, 5, 1]]))).toBe(0);
  });
});

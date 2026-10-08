/**
 * A national food composition table, searched in memory (spec §13J/§13K).
 *
 * Ciqual (France) and the Canadian Nutrient File share everything that
 * matters here: they are bilingual, published as files rather than served,
 * reduced by a build script to a compact committed table, and searched on
 * the server with no key, no network and no running cost. One module, so
 * the two cannot drift into answering the same query differently.
 *
 * Every word must appear in the French or the English name. A result is
 * named in the language the query matched, with the other language kept in
 * `description`, so the screen shows both and ranking compares against the
 * words actually typed.
 */

import type { FoodProvider } from "@/lib/food/provider";
import { fold, terms } from "@/lib/food/text-match";
import type { Food, FoodSearchQuery, FoodServing, ProviderResult } from "@/lib/food/types";

export type TableFood = {
  code: string;
  fr: string;
  en: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number | null;
  sugar_g: number | null;
  sat_fat_g: number | null;
  sodium_mg: number | null;
  /** Analysed, rather than computed from a recipe. */
  verified: boolean;
  /** Household measures, in grams, as the publisher gave them. */
  servings: [label: string, grams: number][];
};

export type ReferenceTable = {
  source: "ciqual" | "cnf";
  name: string;
  edition: string;
  /** Which language names a result when the query matches both equally. */
  preferred: "fr" | "en";
  /** Loaded once, on first search. */
  load: () => TableFood[];
  /** The publisher's generic average food, preferred for a bare query. */
  isGeneric?: (foldedFr: string, foldedEn: string) => boolean;
};

type Indexed = { food: TableFood; fr: string; en: string; generic: boolean };

const coverage = (haystack: string, words: string[]) =>
  words.filter((w) => haystack.includes(w)).length / words.length;

export function createReferenceTable(table: ReferenceTable) {
  let index: Indexed[] | null = null;
  const getIndex = () => {
    index ??= table.load().map((food) => {
      const fr = fold(food.fr);
      const en = fold(food.en);
      return { food, fr, en, generic: table.isGeneric?.(fr, en) ?? false };
    });
    return index;
  };

  function toFood(food: TableFood, language: "fr" | "en"): Food {
    const servings: FoodServing[] = food.servings.map(([label, grams], i) => ({
      label,
      grams,
      isDefault: i === 0,
    }));
    return {
      sourceId: food.code,
      source: table.source,
      name: language === "fr" ? food.fr : food.en,
      brand: null,
      description: language === "fr" ? food.en : food.fr,
      barcode: null,
      isVerified: food.verified,
      nutrients: {
        kcal: food.kcal,
        protein_g: food.protein_g,
        carbs_g: food.carbs_g,
        fat_g: food.fat_g,
        fiber_g: food.fiber_g,
        sugar_g: food.sugar_g,
        sat_fat_g: food.sat_fat_g,
        sodium_mg: food.sodium_mg,
      },
      servings,
      dataUpdatedAt: table.edition,
    };
  }

  /**
   * The whole phrase first, then names that start with the first word, the
   * publisher's generic average food ahead of a specific kind, then shorter
   * names.
   */
  function search(text: string, limit = 10): Food[] {
    const words = terms(text);
    if (words.length === 0) return [];
    const needle = words.join(" ");

    const hits: { food: Food; score: number; length: number }[] = [];
    for (const item of getIndex()) {
      const fr = coverage(item.fr, words);
      const en = coverage(item.en, words);
      if (fr < 1 && en < 1) continue;
      const language: "fr" | "en" =
        fr === en ? table.preferred : fr > en ? "fr" : "en";
      const name = language === "fr" ? item.fr : item.en;
      const score =
        (name.includes(needle) ? 2 : 0) +
        (name.startsWith(words[0]) ? 1 : 0) +
        (item.generic ? 0.5 : 0);
      hits.push({ food: toFood(item.food, language), score, length: name.length });
    }

    return hits
      .sort((a, b) => b.score - a.score || a.length - b.length)
      .slice(0, limit)
      .map((h) => h.food);
  }

  const provider: FoodProvider = {
    name: table.name,
    isAvailable: () => true,
    async search(query: FoodSearchQuery): Promise<ProviderResult> {
      try {
        return { source: table.source, ok: true, foods: search(query.text, query.limit ?? 10) };
      } catch {
        return { source: table.source, ok: false, foods: [], error: `${table.name} could not be searched.` };
      }
    },
  };

  return { search, provider };
}

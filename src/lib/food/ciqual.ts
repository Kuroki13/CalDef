/**
 * Ciqual — the French national food composition table (spec §13J).
 *
 * ANSES, Table de composition nutritionnelle des aliments Ciqual 2025,
 * doi:10.57745/RDMHWY, Licence Ouverte / Etalab 2.0. Adopted by the owner on
 * 2026-10-08 after the evaluation in docs/DATASET_EVALUATION.md.
 *
 * A provider like USDA and Open Food Facts, behind the same port, with one
 * difference: there is no service to call. The table is reduced by
 * `scripts/build-ciqual.mjs` to a compact file bundled with the server code,
 * and searched in memory. No key, no network, no running cost — and no way
 * for it to be "down". A food reaches the database only when someone logs
 * it, exactly as provider foods always have.
 *
 * Names are bilingual. Each result is named in the language the query
 * matched — "maple syrup" finds "Maple syrup", "sirop d'érable" finds
 * "Sirop d'érable" — with the other language kept in `description`, so the
 * screen can show both and ranking compares against the words typed.
 *
 * Every food carries the figures ANSES published, per 100 g, with the
 * conservative reading the build script documents. Foods ANSES left without
 * an energy or core macro figure are not in the file at all.
 */

import data from "@/lib/food/data/ciqual.json";
import type { FoodProvider } from "@/lib/food/provider";
import { fold, terms } from "@/lib/food/text-match";
import type { Food, FoodSearchQuery, ProviderResult } from "@/lib/food/types";

type Row = [
  code: string,
  fr: string,
  en: string,
  kcal: number,
  protein: number,
  carbs: number,
  fat: number,
  fiber: number | null,
  sugar: number | null,
  satFat: number | null,
  sodium: number | null,
];

type Indexed = { row: Row; fr: string; en: string };

let index: Indexed[] | null = null;

/** Folded once, on first use, and kept for the life of the instance. */
function getIndex(): Indexed[] {
  index ??= (data.foods as Row[]).map((row) => ({
    row,
    fr: fold(row[1]),
    en: fold(row[2]),
  }));
  return index;
}

function coverage(haystack: string, words: string[]): number {
  return words.filter((w) => haystack.includes(w)).length / words.length;
}

export function toFood(row: Row, language: "fr" | "en"): Food {
  const [code, fr, en, kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sat_fat_g, sodium_mg] = row;
  return {
    sourceId: code,
    source: "ciqual",
    name: language === "fr" ? fr : en,
    brand: null,
    // The other language, shown beneath the name.
    description: language === "fr" ? en : fr,
    barcode: null,
    // A national laboratory-based table, like USDA Foundation/SR Legacy.
    isVerified: true,
    nutrients: { kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sat_fat_g, sodium_mg },
    servings: [],
    dataUpdatedAt: data.edition,
  };
}

/**
 * Every word must appear in the French or the English name. The whole phrase
 * first, then names that start with the first word, ANSES's generic average
 * food ahead of a specific kind, then shorter names.
 */
export function searchCiqual(text: string, limit = 10): Food[] {
  const words = terms(text);
  if (words.length === 0) return [];
  const needle = words.join(" ");

  const hits: { food: Food; score: number; length: number }[] = [];
  for (const item of getIndex()) {
    const fr = coverage(item.fr, words);
    const en = coverage(item.en, words);
    if (fr < 1 && en < 1) continue;
    const language = fr >= en ? "fr" : "en";
    const name = language === "fr" ? item.fr : item.en;
    // ANSES marks its generic reference food "sans précision (aliment
    // moyen)" — the average across kinds, the right answer to a bare
    // "croissant" before "Croissant ordinaire, artisanal".
    const generic = item.fr.includes("aliment moyen") || item.fr.includes("sans precision");
    const score =
      (name.includes(needle) ? 2 : 0) +
      (name.startsWith(words[0]) ? 1 : 0) +
      (generic ? 0.5 : 0);
    hits.push({ food: toFood(item.row, language), score, length: name.length });
  }

  return hits
    .sort((a, b) => b.score - a.score || a.length - b.length)
    .slice(0, limit)
    .map((h) => h.food);
}

export const ciqualProvider: FoodProvider = {
  name: "Ciqual (ANSES)",
  isAvailable: () => true,
  async search(query: FoodSearchQuery): Promise<ProviderResult> {
    try {
      return { source: "ciqual", ok: true, foods: searchCiqual(query.text, query.limit ?? 10) };
    } catch {
      return { source: "ciqual", ok: false, foods: [], error: "Ciqual could not be searched." };
    }
  },
};

export { ATTRIBUTION } from "@/lib/food/attribution";

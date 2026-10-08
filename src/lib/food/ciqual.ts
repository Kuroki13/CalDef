/**
 * Ciqual — the French national food composition table (spec §13J).
 *
 * ANSES, Table de composition nutritionnelle des aliments Ciqual 2025,
 * doi:10.57745/RDMHWY, Licence Ouverte / Etalab 2.0. Adopted by the owner on
 * 2026-10-08 after the evaluation in docs/DATASET_EVALUATION.md.
 *
 * Reduced by `scripts/build-ciqual.mjs` to a committed table and searched in
 * memory through `reference-table.ts` — no key, no network, no running
 * cost. Foods ANSES left without an energy or core macro figure are not in
 * the table at all. Ciqual gives no household measures, so "un pot" stays
 * unconverted unless the user's own serving says what it weighs (§13J).
 */

import data from "@/lib/food/data/ciqual.json";
import { createReferenceTable, type TableFood } from "@/lib/food/reference-table";

type Row = [string, string, string, number, number, number, number, number | null, number | null, number | null, number | null];

const table = createReferenceTable({
  source: "ciqual",
  name: "Ciqual (ANSES)",
  edition: data.edition,
  preferred: "fr",
  load: () =>
    (data.foods as Row[]).map(
      ([code, fr, en, kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sat_fat_g, sodium_mg]): TableFood => ({
        code, fr, en, kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sat_fat_g, sodium_mg,
        verified: true,
        servings: [],
      }),
    ),
  // ANSES marks its generic reference food "sans précision (aliment
  // moyen)" — the average across kinds, the right answer to a bare
  // "croissant" before "Croissant ordinaire, artisanal".
  isGeneric: (fr) => fr.includes("aliment moyen") || fr.includes("sans precision"),
});

export const searchCiqual = table.search;
export const ciqualProvider = table.provider;

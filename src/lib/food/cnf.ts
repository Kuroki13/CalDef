/**
 * The Canadian Nutrient File — Health Canada's reference table (spec §13K).
 *
 * Canadian Nutrient File 2026, Open Government Licence – Canada. Adopted by
 * the owner on 2026-10-08 after the evaluation in docs/DATASET_EVALUATION.md.
 *
 * Only the 1,195 foods Health Canada did not take from USDA are here —
 * poutine, tourtière, cretons, tarte au sucre, traditional foods, Canadian
 * analyses. The rest is USDA under a second name, which CalDef already
 * searches; carrying it twice would duplicate foods blindly (§13K).
 *
 * Each food brings Health Canada's household measures as servings, in
 * grams — "1 pie (20 cm dia)" is 450 g of tourtière — and a recipe
 * compilation (computed, not analysed) is not marked verified, so it shows
 * as Estimated.
 */

import data from "@/lib/food/data/cnf.json";
import { createReferenceTable, type TableFood } from "@/lib/food/reference-table";

type Row = [
  string, string, string, number, number, number, number,
  number | null, number | null, number | null, number | null,
  boolean, [string, number][],
];

const table = createReferenceTable({
  source: "cnf",
  name: "Canadian Nutrient File (Health Canada)",
  edition: data.edition,
  preferred: "en",
  load: () =>
    (data.foods as Row[]).map(
      ([code, en, fr, kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sat_fat_g, sodium_mg, verified, servings]): TableFood => ({
        code, fr, en, kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sat_fat_g, sodium_mg,
        verified,
        servings,
      }),
    ),
});

export const searchCnf = table.search;
export const cnfProvider = table.provider;

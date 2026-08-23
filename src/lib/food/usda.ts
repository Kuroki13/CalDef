import "server-only";

/**
 * USDA FoodData Central.
 *
 * The spec's source for generic whole foods — chicken breast, rice, eggs,
 * a banana. Branded entries exist here too, but Open Food Facts covers
 * packaged goods better, so this provider asks for the laboratory-analysed
 * datasets first.
 *
 * Only the search endpoint is used. It returns per-100 g nutrients inline,
 * which is everything the domain layer needs, and avoids a second round trip
 * per result.
 */

import {
  type FoodProvider,
  ProviderHttpError,
  providerFetch,
  safeProviderCall,
} from "@/lib/food/provider";
import type { Food, FoodSearchQuery, ProviderResult } from "@/lib/food/types";
import { USDA_API_KEY, hasUsdaKey } from "@/lib/env.server";
import { kcalFromMacros } from "@/lib/nutrition/macros";

const ENDPOINT = "https://api.nal.usda.gov/fdc/v1/foods/search";

/**
 * Laboratory-analysed datasets first, then the survey set.
 *
 * Foundation and SR Legacy are what "generic whole food" means here.
 * Branded is deliberately excluded: those entries are self-reported by
 * manufacturers and Open Food Facts handles that category.
 */
const DATA_TYPES = ["Foundation", "SR Legacy", "Survey (FNDDS)"];

/** USDA nutrient ids. Stable, and far safer to match on than names. */
const NUTRIENT_IDS = {
  kcal: 1008,
  protein: 1003,
  fat: 1004,
  carbs: 1005,
  fiber: 1079,
  sugar: 2000,
  satFat: 1258,
  sodium: 1093,
} as const;

type UsdaNutrient = {
  nutrientId?: number;
  unitName?: string;
  value?: number;
};

type UsdaFood = {
  fdcId?: number;
  description?: string;
  dataType?: string;
  brandOwner?: string;
  brandName?: string;
  gtinUpc?: string;
  publishedDate?: string;
  foodNutrients?: UsdaNutrient[];
};

export const usdaProvider: FoodProvider = {
  name: "USDA FoodData Central",

  isAvailable: hasUsdaKey,

  async search(query: FoodSearchQuery): Promise<ProviderResult> {
    if (!hasUsdaKey()) {
      return {
        source: "usda",
        ok: false,
        foods: [],
        error: "USDA search is not configured.",
      };
    }
    return safeProviderCall("usda", () => runSearch(query));
  },
};

async function runSearch({ text, limit = 15 }: FoodSearchQuery): Promise<Food[]> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("query", text);
  url.searchParams.set("pageSize", String(Math.min(limit, 50)));
  url.searchParams.set("dataType", DATA_TYPES.join(","));
  // The key goes in the query string because that is the only auth this API
  // accepts. It never leaves the server, and provider errors are sanitised
  // so the URL cannot reach a log or a user-facing message.
  url.searchParams.set("api_key", USDA_API_KEY ?? "");

  const response = await providerFetch(url.toString());
  if (!response.ok) throw new ProviderHttpError(response.status);

  const body = (await response.json()) as { foods?: UsdaFood[] };
  return (body.foods ?? []).flatMap(toFood);
}

/** Maps one USDA row, dropping anything we cannot compute honestly. */
function toFood(raw: UsdaFood): Food[] {
  if (!raw.fdcId || !raw.description) return [];

  const n = raw.foodNutrients ?? [];
  const protein_g = valueOf(n, NUTRIENT_IDS.protein) ?? 0;
  const carbs_g = valueOf(n, NUTRIENT_IDS.carbs) ?? 0;
  const fat_g = valueOf(n, NUTRIENT_IDS.fat) ?? 0;

  // Some rows in the search response carry macros but no energy figure.
  // Deriving it from the macros is legitimate — it is arithmetic on real
  // measured values, not a guess — but a row with neither is unusable.
  const kcal = valueOf(n, NUTRIENT_IDS.kcal) ?? kcalFromMacros({ protein_g, carbs_g, fat_g });
  if (kcal <= 0 && protein_g === 0 && carbs_g === 0 && fat_g === 0) return [];

  return [
    {
      sourceId: String(raw.fdcId),
      source: "usda",
      name: titleCase(raw.description),
      brand: raw.brandName || raw.brandOwner || null,
      description: raw.dataType ?? null,
      barcode: raw.gtinUpc || null,
      // Foundation and SR Legacy are laboratory-analysed. Survey values are
      // modelled from them, so they are not claimed as verified.
      isVerified:
        raw.dataType === "Foundation" || raw.dataType === "SR Legacy",
      nutrients: {
        kcal: round2(kcal),
        protein_g: round2(protein_g),
        carbs_g: round2(carbs_g),
        fat_g: round2(fat_g),
        fiber_g: valueOf(n, NUTRIENT_IDS.fiber) ?? null,
        sugar_g: valueOf(n, NUTRIENT_IDS.sugar) ?? null,
        sat_fat_g: valueOf(n, NUTRIENT_IDS.satFat) ?? null,
        sodium_mg: valueOf(n, NUTRIENT_IDS.sodium) ?? null,
      },
      // USDA's generic datasets carry no household portions in the search
      // response, so a 100 g reference serving is offered and the user
      // enters grams directly.
      servings: [{ label: "100 g", grams: 100, isDefault: true }],
      dataUpdatedAt: raw.publishedDate ?? null,
    },
  ];
}

function valueOf(nutrients: UsdaNutrient[], id: number): number | null {
  const match = nutrients.find((x) => x.nutrientId === id);
  return typeof match?.value === "number" ? match.value : null;
}

/** USDA descriptions arrive shouting ("CHICKEN BREAST") often enough to fix. */
function titleCase(text: string): string {
  const trimmed = text.trim();
  if (trimmed !== trimmed.toUpperCase()) return trimmed;
  return trimmed
    .toLowerCase()
    .replace(/(^|[\s(,/-])([a-z])/g, (_, prefix, letter) => prefix + letter.toUpperCase());
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

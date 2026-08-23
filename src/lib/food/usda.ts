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
 * The laboratory-analysed datasets, which is what "generic whole food" means
 * here.
 *
 * Branded is deliberately excluded: those entries are self-reported by
 * manufacturers, and Open Food Facts handles that category better.
 *
 * `Survey (FNDDS)` is excluded too, for a blunter reason — sending it makes
 * FoodData Central answer 400 (observed 2026-08-23; the parenthesised value
 * does not survive the round trip). Its values are modelled from Foundation
 * and SR Legacy rather than measured, so nothing is lost by omitting it.
 */
const DATA_TYPES = ["Foundation", "SR Legacy"];

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

  // FoodData Central intermittently answers 404 to perfectly valid search
  // requests — observed 2026-08-23 failing roughly half of identical repeat
  // calls while still returning healthy rate-limit headers. It is a lying
  // status from an unwell backend rather than a real "no such endpoint", so
  // it is treated as retryable here even though 404 normally would not be.
  const response = await providerFetch(
    url.toString(),
    {},
    { retries: 3, retryStatuses: [404, 429, 500, 502, 503, 504] },
  );
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
      // Foundation and SR Legacy are laboratory-analysed. Anything else that
      // reaches us — a dataset added upstream later — is not claimed as
      // verified without checking what it actually is.
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

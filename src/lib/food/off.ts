import "server-only";

/**
 * Open Food Facts.
 *
 * The spec's source for branded and barcoded products, including French
 * supermarket items. No key required.
 *
 * Barcode lookup uses API v3, as the spec directs for new integrations.
 *
 * Search uses the legacy `/cgi/search.pl` endpoint, which is the only Open
 * Food Facts endpoint that honours a free-text `search_terms`. `/api/v2/search`
 * accepts tag filters only; it does not reject an unknown parameter, it
 * ignores it — so `search_terms=dubai` there returned the unfiltered database
 * (count 4.7 million, page 1) rather than an error. See the note in
 * `runSearch`.
 *
 * The data is community-contributed and photographed off packaging. Every
 * food from here is returned unverified, and the caller is expected to show
 * the source rather than present it as authoritative.
 */

import {
  type FoodProvider,
  ProviderHttpError,
  providerFetch,
  safeProviderCall,
} from "@/lib/food/provider";
import type {
  Food,
  FoodSearchQuery,
  FoodServing,
  ProviderResult,
} from "@/lib/food/types";

const BASE = "https://world.openfoodfacts.org";

const FIELDS = [
  "code",
  "product_name",
  "brands",
  "quantity",
  "serving_size",
  "serving_quantity",
  "nutriments",
  "last_modified_t",
].join(",");

type OffNutriments = Record<string, number | string | undefined>;

type OffProduct = {
  code?: string;
  product_name?: string;
  brands?: string;
  quantity?: string;
  serving_size?: string;
  serving_quantity?: number | string;
  nutriments?: OffNutriments;
  last_modified_t?: number;
};

export const offProvider: FoodProvider = {
  name: "Open Food Facts",

  // No credential, so it is always configured. Whether it responds is a
  // separate question, and that is what the degradation path is for.
  isAvailable: () => true,

  async search(query: FoodSearchQuery): Promise<ProviderResult> {
    return safeProviderCall("off", () => runSearch(query));
  },

  async lookupBarcode(barcode: string): Promise<Food | null> {
    if (!/^[0-9]{6,14}$/.test(barcode)) return null;

    const url = `${BASE}/api/v3/product/${barcode}.json?fields=${FIELDS}`;
    // 404 is deliberately not retryable here: for this endpoint it means the
    // product genuinely is not in the database, which is an answer.
    const response = await providerFetch(url, {}, { retries: 2 });

    if (response.status === 404) return null;
    if (!response.ok) throw new ProviderHttpError(response.status);

    const body = (await response.json()) as {
      status?: string;
      product?: OffProduct;
    };
    if (!body.product) return null;

    return toFood(body.product);
  },
};

/**
 * Full-text product search.
 *
 * `/cgi/search.pl` rather than `/api/v2/search`, because only the former
 * honours `search_terms`. v2 filters on tags (`categories_tags`,
 * `brands_tags`, …) and silently discards parameters it does not recognise,
 * so the v2 call this replaced returned page 1 of the entire database on
 * every query — searching "dubai" produced Moroccan bottled water and
 * yoghurt, matched to nothing the user typed. Unrelated results are worse
 * than none: they look like real answers.
 *
 * `search_simple=1&action=process` is the form the endpoint documents for a
 * one-term query; `json=1` selects the JSON response over the HTML page.
 */
async function runSearch({ text, limit = 15 }: FoodSearchQuery): Promise<Food[]> {
  const url = new URL(`${BASE}/cgi/search.pl`);
  url.searchParams.set("search_terms", text);
  url.searchParams.set("search_simple", "1");
  url.searchParams.set("action", "process");
  url.searchParams.set("json", "1");
  url.searchParams.set("fields", FIELDS);
  url.searchParams.set("page_size", String(Math.min(limit, 50)));

  // The search backend is the flakiest part of Open Food Facts and answers
  // 503 under load while the product endpoint stays healthy.
  const response = await providerFetch(url.toString(), {}, { retries: 2 });
  if (!response.ok) throw new ProviderHttpError(response.status);

  const body = (await response.json()) as { products?: OffProduct[] };
  return (body.products ?? []).flatMap((p) => {
    const food = toFood(p);
    return food ? [food] : [];
  });
}

function toFood(raw: OffProduct): Food | null {
  const code = raw.code?.trim();
  const name = raw.product_name?.trim();
  if (!code || !name) return null;

  const n = raw.nutriments ?? {};
  const kcal = num(n["energy-kcal_100g"]);
  const protein_g = num(n["proteins_100g"]) ?? 0;
  const carbs_g = num(n["carbohydrates_100g"]) ?? 0;
  const fat_g = num(n["fat_100g"]) ?? 0;

  // A product with no energy value at all is not usable for a diary entry.
  // Community data is frequently incomplete, and skipping is the honest
  // response — better a shorter result list than an invented calorie count.
  if (kcal === null) return null;

  // OFF reports sodium in grams per 100 g; the column stores milligrams.
  const sodiumG = num(n["sodium_100g"]);

  return {
    sourceId: code,
    source: "off",
    name,
    brand: firstBrand(raw.brands),
    description: raw.quantity?.trim() || null,
    barcode: /^[0-9]{6,14}$/.test(code) ? code : null,
    // Never verified: this is user-contributed data by design.
    isVerified: false,
    nutrients: {
      kcal: round2(kcal),
      protein_g: round2(protein_g),
      carbs_g: round2(carbs_g),
      fat_g: round2(fat_g),
      fiber_g: num(n["fiber_100g"]),
      sugar_g: num(n["sugars_100g"]),
      sat_fat_g: num(n["saturated-fat_100g"]),
      sodium_mg: sodiumG === null ? null : round2(sodiumG * 1000),
    },
    servings: servingsFor(raw),
    dataUpdatedAt: raw.last_modified_t
      ? new Date(raw.last_modified_t * 1000).toISOString()
      : null,
  };
}

/**
 * A 100 g reference always, plus the package's own serving when it states
 * one in grams.
 *
 * `serving_quantity` is the parsed gram weight of `serving_size`. When it is
 * missing or unparseable the serving is dropped rather than guessed — an
 * invented gram weight would silently scale every macro in the entry.
 */
function servingsFor(raw: OffProduct): FoodServing[] {
  const servings: FoodServing[] = [
    { label: "100 g", grams: 100, isDefault: true },
  ];

  const grams = num(raw.serving_quantity);
  if (grams !== null && grams > 0 && grams <= 100000) {
    servings.push({
      label: raw.serving_size?.trim() || "1 serving",
      grams: round2(grams),
      isDefault: false,
    });
  }

  return servings;
}

/** `brands` is a comma-separated list; the first is the one to show. */
function firstBrand(brands?: string): string | null {
  const first = brands?.split(",")[0]?.trim();
  return first || null;
}

/** OFF returns numbers as numbers or as strings, depending on the field. */
function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

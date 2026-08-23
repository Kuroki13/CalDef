/**
 * The neutral food shapes.
 *
 * ARCHITECTURE invariant: no provider-specific type escapes `src/lib/food`.
 * UI code, the diary and the AI path all see these shapes and never a USDA
 * or Open Food Facts payload, which is what makes providers swappable and
 * keeps a provider's schema change from reaching the interface.
 */

import type { Nutrients } from "@/lib/nutrition/macros";

/** Matches the `public.food_source` enum. */
export type FoodSource = "usda" | "off" | "custom";

export type FoodServing = {
  label: string;
  grams: number;
  isDefault: boolean;
};

export type Food = {
  /** Stable id within the provider. `foods.source_id`. */
  sourceId: string;
  source: FoodSource;
  name: string;
  brand: string | null;
  description: string | null;
  barcode: string | null;
  /**
   * Whether the source vouches for the data.
   *
   * USDA Foundation and SR Legacy are laboratory-analysed; Open Food Facts
   * is community-contributed and photographed off packaging. The spec
   * requires showing this rather than presenting every entry as verified.
   */
  isVerified: boolean;
  /** Per 100 g. The only nutrition figures the app ever trusts. */
  nutrients: Nutrients & {
    fiber_g?: number | null;
    sugar_g?: number | null;
    sat_fat_g?: number | null;
    sodium_mg?: number | null;
  };
  servings: FoodServing[];
  /** When the provider last revised the record, if it says. */
  dataUpdatedAt: string | null;
};

/** A food that has been cached locally, so it carries a database id. */
export type CachedFood = Food & { id: number };

export type FoodSearchQuery = {
  text: string;
  limit?: number;
};

/**
 * One provider's contribution to a search.
 *
 * Failure is a value, not an exception: a dead provider must degrade the
 * result set rather than break the search (ARCHITECTURE invariant 7). The
 * UI reads `ok` to decide whether to note that a source was unavailable.
 */
export type ProviderResult = {
  source: FoodSource | "cache";
  ok: boolean;
  foods: Food[];
  /** Present when `ok` is false. Safe to show; never contains a key. */
  error?: string;
};

export type SearchOutcome = {
  foods: Food[];
  results: ProviderResult[];
  /** True when at least one source failed, so the UI can say so. */
  degraded: boolean;
};

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
  /**
   * What the label is per 100 of. Nutrients are per 100 g regardless; a
   * drink is `ml`, resolved at 1 g/ml, so it reads and logs in millilitres.
   * Absent means grams — every provider food is.
   */
  basisUnit?: "g" | "ml";
  /** The owner's note on their own food. Never present on a provider row. */
  notes?: string | null;
};

/**
 * A food that has been cached locally, so it carries a database id.
 *
 * `refreshedAt` is when the row last agreed with its provider. It is what
 * decides whether a search that just heard from that provider should write
 * the answer back — see `lib/food/staleness.ts`. Null on a row that predates
 * the column, which counts as stale.
 */
export type CachedFood = Food & { id: number; refreshedAt?: string | null };

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

/**
 * A dish recognised in the query (§13A–§13D): what the words named, never
 * what it contains. Sent to the screen so it can say what was understood
 * and ask the one variant question that matters.
 */
export type RecognisedDish = {
  id: string;
  name: string;
  arabic: string;
  about: string;
  /** The variant the query named, if any. */
  variant: { id: string; label: string } | null;
  /** Every variant the dish has, for the question; empty when none differ. */
  variants: { id: string; label: string; searchAs: string }[];
  variantOpen: boolean;
  /** What the databases were searched with. */
  searchAs: string;
};

export type SearchOutcome = {
  foods: Food[];
  results: ProviderResult[];
  /** True when at least one source failed, so the UI can say so. */
  degraded: boolean;
  /** The dish the query named, if it named one from the dictionary. */
  recognised?: RecognisedDish | null;
  /**
   * Whether anything returned answers the query — by its words, or by
   * naming the same dish under another spelling. The screen offers other
   * ways in when this is false.
   */
  strongMatch?: boolean;
};

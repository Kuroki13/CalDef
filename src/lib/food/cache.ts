import "server-only";

/**
 * The local food cache.
 *
 * The spec's rule: logging the same chicken breast repeatedly must not
 * repeatedly hit an external API. Every food a provider resolves is written
 * back to `foods` / `food_servings` / `food_nutrients`, and the cache is
 * searched first on the next query.
 *
 * The cache is also what makes a logged entry durable. `food_logs` stores
 * the computed macros at log time and references the cached food, so a
 * provider outage — or a provider deleting a product — cannot retroactively
 * empty out a diary.
 */

import { createClient } from "@/lib/supabase/server";
import type { CachedFood, Food, FoodSearchQuery } from "@/lib/food/types";

/**
 * Splits a query into terms for matching.
 *
 * Each term is matched independently against `search_text`, because provider
 * names are punctuated in ways a user never types: USDA calls it "Chicken,
 * breast, boneless, skinless, raw", so a search for "boneless skinless"
 * matched nothing as a single substring and the cache was missed on every
 * multi-word query — sending us back to the provider for a food we already
 * held, which is precisely what the cache exists to prevent.
 *
 * `%` and `_` are stripped rather than escaped: they are wildcards in
 * `ilike`, and a user typing them means the literal character, not a
 * pattern.
 */
function searchTerms(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((term) => term.replace(/[%_]/g, "").trim())
    .filter((term) => term.length > 0)
    .slice(0, 6);
}

/**
 * Searches the local cache.
 *
 * Uses the generated `foods.search_text` column and its trigram GIN index.
 * Custom foods are visible only to their owner, which RLS enforces — this
 * query does not need to filter by user itself.
 */
export async function searchCache({
  text,
  limit = 15,
}: FoodSearchQuery): Promise<CachedFood[]> {
  const terms = searchTerms(text);
  if (terms.length === 0) return [];

  const supabase = await createClient();

  let query = supabase
    .from("foods")
    .select(
      `id, source, source_id, name, brand, description, barcode, is_verified,
       data_updated_at,
       food_nutrients (kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g,
                       sat_fat_g, sodium_mg),
       food_servings (label, grams, is_default)`,
    );

  // Every term must appear somewhere in the text, in any order.
  for (const term of terms) {
    query = query.ilike("search_text", `%${term}%`);
  }

  // A retired custom food stays readable wherever history points at it, but
  // it is not offered again — that is what retiring one means.
  const { data, error } = await query.is("archived_at", null).limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []).flatMap(rowToFood);
}

/** Exported for testing the term splitting in isolation. */
export const __searchTerms = searchTerms;

/**
 * Finds a cached food by barcode, before any network call.
 *
 * Takes the first of possibly several rows rather than insisting on exactly
 * one. A barcode is unique on a packet but not in this table: a user may
 * enter their own food for a product Open Food Facts already knows, and
 * demanding a single row would turn that into an error on a lookup that
 * works perfectly well for everybody else. Owned rows sort first, so
 * scanning a product you have written your own numbers for gives you yours.
 */
export async function findCachedByBarcode(
  barcode: string,
): Promise<CachedFood | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("foods")
    .select(
      `id, source, source_id, name, brand, description, barcode, is_verified,
       data_updated_at,
       food_nutrients (kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g,
                       sat_fat_g, sodium_mg),
       food_servings (label, grams, is_default)`,
    )
    .eq("barcode", barcode)
    .is("archived_at", null)
    .order("user_id", { ascending: true, nullsFirst: false })
    .limit(1);

  if (error) throw new Error(error.message);
  return (data ?? []).flatMap(rowToFood)[0] ?? null;
}

/**
 * Writes a provider food into the cache and returns its database id.
 *
 * Idempotent on `(source, source_id)`, and deliberately **insert-only**.
 *
 * Shared cache rows carry `user_id IS NULL`, and the RLS policies allow
 * anyone authenticated to insert one but only its owner to update it —
 * `foods_update_own` reads `auth.uid() = user_id`, which is never true for a
 * null owner. Writing an update path anyway would not fail loudly: a plain
 * `update` would report success having matched zero rows, and an `upsert`
 * would raise an RLS violation the first time a food was re-resolved.
 *
 * So an existing food is reused as-is rather than refreshed. That is the
 * correct trade: the alternative is granting every authenticated user write
 * access to shared nutrition data, which is exactly the multi-tenant hole
 * the policies exist to close. See KNOWN ISSUES in IMPLEMENTATION_STATUS.md
 * for how a refresh path would have to work.
 *
 * Custom foods do not come through here at all. They are owned rows, and
 * this function writes `user_id` nowhere — an insert from here would either
 * violate `foods_custom_requires_owner` or, worse, succeed in creating an
 * ownerless copy of somebody's private food. `lib/food/custom.ts` is their
 * only writer, and the guard below says so rather than leaving it to a
 * constraint to notice.
 */
export async function cacheFood(food: Food): Promise<number> {
  if (food.source === "custom" && food.sourceId.startsWith("restaurant:")) {
    const { restaurantById } = await import("@/lib/food/restaurant-catalogue");
    if (restaurantById(food.sourceId)) {
      const { importRestaurantFood } = await import("@/lib/food/restaurant-import");
      return importRestaurantFood(food.sourceId);
    }
  }
  const supabase = await createClient();

  if (food.source === "custom") {
    const existing = await findOwnCustomFood(food.sourceId);
    if (existing !== null) return existing;
    throw new Error("A custom food can only be created by its owner.");
  }

  const { data: existing, error: lookupError } = await supabase
    .from("foods")
    .select("id")
    .eq("source", food.source)
    .eq("source_id", food.sourceId)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  if (existing) return existing.id;

  const { data: inserted, error: insertError } = await supabase
    .from("foods")
    .insert({
      source: food.source,
      source_id: food.sourceId,
      name: food.name,
      brand: food.brand,
      description: food.description,
      barcode: food.barcode,
      is_verified: food.isVerified,
      data_updated_at: food.dataUpdatedAt,
    })
    .select("id")
    .single();
  if (insertError) throw new Error(insertError.message);

  const foodId = inserted.id;

  const { error: nutrientError } = await supabase
    .from("food_nutrients")
    .insert({
      food_id: foodId,
      kcal: food.nutrients.kcal,
      protein_g: food.nutrients.protein_g,
      carbs_g: food.nutrients.carbs_g,
      fat_g: food.nutrients.fat_g,
      fiber_g: food.nutrients.fiber_g ?? null,
      sugar_g: food.nutrients.sugar_g ?? null,
      sat_fat_g: food.nutrients.sat_fat_g ?? null,
      sodium_mg: food.nutrients.sodium_mg ?? null,
    });
  if (nutrientError) throw new Error(nutrientError.message);

  if (food.servings.length > 0) {
    const { error: servingError } = await supabase
      .from("food_servings")
      .insert(
        food.servings.map((serving) => ({
          food_id: foodId,
          label: serving.label,
          grams: serving.grams,
          is_default: serving.isDefault,
        })),
      );
    if (servingError) throw new Error(servingError.message);
  }

  return foodId;
}

/**
 * Resolves one of the user's own custom foods by its `source_id`.
 *
 * RLS is what makes this safe: another user's custom food is not selectable,
 * so a payload naming one comes back empty and is refused above rather than
 * logged against a stranger's numbers.
 */
async function findOwnCustomFood(sourceId: string): Promise<number | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("foods")
    .select("id")
    .eq("source", "custom")
    .eq("source_id", sourceId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  return data?.id ?? null;
}

/** The shape a `foods` row plus its embedded relations comes back as. */
type FoodRow = {
  id: number;
  source: string;
  source_id: string | null;
  name: string;
  brand: string | null;
  description: string | null;
  barcode: string | null;
  is_verified: boolean;
  data_updated_at: string | null;
  food_nutrients: {
    kcal: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    fiber_g: number | null;
    sugar_g: number | null;
    sat_fat_g: number | null;
    sodium_mg: number | null;
  } | null;
  food_servings: {
    label: string;
    grams: number;
    is_default: boolean;
  }[];
};

/**
 * Maps a row back to the neutral shape.
 *
 * A food with no nutrient row is dropped rather than defaulted to zero. A
 * zero-calorie entry that silently logs nothing is worse than an absent one.
 */
export function rowToFood(row: FoodRow): CachedFood[] {
  if (!row.food_nutrients) return [];

  return [
    {
      id: row.id,
      sourceId: row.source_id ?? String(row.id),
      source: row.source as CachedFood["source"],
      name: row.name,
      brand: row.brand,
      description: row.description,
      barcode: row.barcode,
      isVerified: row.is_verified,
      nutrients: { ...row.food_nutrients },
      servings: (row.food_servings ?? []).map((s) => ({
        label: s.label,
        grams: s.grams,
        isDefault: s.is_default,
      })),
      dataUpdatedAt: row.data_updated_at,
    },
  ];
}

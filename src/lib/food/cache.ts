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

import { namesDish } from "@/lib/food/cultural/recognise";
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
       data_updated_at, refreshed_at, basis_unit,
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
       data_updated_at, refreshed_at, basis_unit,
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
 * The owner's own foods whose names name a dish (§13A, §13G).
 *
 * "Mom's Maqlouba" shares no letters with "ma2loubeh" past the first two,
 * so `ilike` will never find it; recognition will. Names only are read —
 * owned rows are visible to their owner alone, so this is the caller's own
 * list — and recognition runs here, server-side: the personal food list is
 * never sent anywhere (§13.2).
 */
export async function ownFoodsNamingDish(dishId: string): Promise<CachedFood[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("foods")
    .select("id, name")
    .not("user_id", "is", null)
    .is("archived_at", null)
    .limit(500);
  if (error || !data) return [];

  const ids = data.filter((row) => namesDish(row.name, dishId)).map((row) => row.id);
  return getCachedFoodsByIds(ids);
}

/**
 * Several cached foods at once, by database id, in no particular order.
 *
 * For the personal library, which knows *which* foods from the diary and
 * needs them in the shape the logging path takes. Retired custom foods are
 * left out: they stay readable wherever history points at them, but the
 * library is for choosing what to eat next, and retiring a food means not
 * being offered it again. RLS limits the rows to shared ones and the
 * caller's own.
 */
export async function getCachedFoodsByIds(
  ids: readonly number[],
): Promise<CachedFood[]> {
  if (ids.length === 0) return [];
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("foods")
    .select(
      `id, source, source_id, name, brand, description, barcode, is_verified,
       data_updated_at, refreshed_at, basis_unit,
       food_nutrients (kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g,
                       sat_fat_g, sodium_mg),
       food_servings (label, grams, is_default)`,
    )
    .in("id", [...ids])
    .is("archived_at", null);

  if (error) throw new Error(error.message);
  return (data ?? []).flatMap(rowToFood);
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
 * Rewrites a stale cached food from a fresh provider response.
 *
 * The counterpart to `cacheFood` being insert-only. A provider food is
 * immutable while it is fresh; once it is older than the window, a search or
 * a barcode lookup that has just heard from the provider anyway writes the
 * answer back. There is no extra network call in it — the response was
 * already fetched for the thing the user asked for.
 *
 * **This cannot reach a diary entry.** `food_logs` holds the macros computed
 * at log time, so what changes here is what the *next* log of this food will
 * say. Nothing already written moves, which is the whole reason those
 * columns are a snapshot rather than a join.
 *
 * Failure is silent by design: a refusal here means the row stopped being
 * stale between the read and the write, or the policy declined it, and
 * neither is a reason to fail the search the user actually asked for. The
 * caller gets the food it already had.
 */
export async function refreshCachedFood(
  foodId: number,
  food: Food,
): Promise<boolean> {
  const supabase = await createClient();

  const { error: nutrientError } = await supabase
    .from("food_nutrients")
    .update({
      kcal: food.nutrients.kcal,
      protein_g: food.nutrients.protein_g,
      carbs_g: food.nutrients.carbs_g,
      fat_g: food.nutrients.fat_g,
      fiber_g: food.nutrients.fiber_g ?? null,
      sugar_g: food.nutrients.sugar_g ?? null,
      sat_fat_g: food.nutrients.sat_fat_g ?? null,
      sodium_mg: food.nutrients.sodium_mg ?? null,
    })
    .eq("food_id", foodId);
  if (nutrientError) return false;

  // Servings are added and corrected, never removed: `food_logs.serving_id`
  // is `on delete set null`, so dropping one would turn "1 slice" into a
  // bare gram figure on an entry already written.
  const { data: existing } = await supabase
    .from("food_servings")
    .select("id, label")
    .eq("food_id", foodId);
  const byLabel = new Map((existing ?? []).map((row) => [row.label, row.id]));

  for (const serving of food.servings) {
    const id = byLabel.get(serving.label);
    if (id) {
      await supabase
        .from("food_servings")
        .update({ grams: serving.grams })
        .eq("id", id);
    } else {
      await supabase.from("food_servings").insert({
        food_id: foodId,
        label: serving.label,
        grams: serving.grams,
        is_default: false,
      });
    }
  }

  // Last, and the row is only considered refreshed if this lands: the
  // timestamp is what the policy reads, so writing it first would close the
  // window on a refresh that had not happened yet.
  const { error } = await supabase
    .from("foods")
    .update({
      name: food.name,
      brand: food.brand,
      is_verified: food.isVerified,
      data_updated_at: food.dataUpdatedAt,
      refreshed_at: new Date().toISOString(),
    })
    .eq("id", foodId)
    .is("user_id", null);

  return !error;
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
  refreshed_at?: string | null;
  notes?: string | null;
  basis_unit?: string | null;
  is_family?: boolean | null;
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
      refreshedAt: row.refreshed_at ?? null,
      basisUnit: row.basis_unit === "ml" ? "ml" : "g",
      notes: row.notes ?? null,
      isFamily: row.is_family === true,
    },
  ];
}

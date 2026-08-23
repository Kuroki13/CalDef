import "server-only";

/**
 * Favourite foods — the quick-access list (spec §7).
 *
 * A favourite is a pointer to a cached food, not a copy of it. That keeps
 * one nutrient row per real food, and it means favouriting something the
 * user has already logged costs nothing extra.
 */

import { rowToFood } from "@/lib/food/cache";
import type { CachedFood } from "@/lib/food/types";
import { createClient, requireUserId } from "@/lib/supabase/server";

const FOOD_COLUMNS = `id, source, source_id, name, brand, description, barcode,
   is_verified, data_updated_at,
   food_nutrients (kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g,
                   sat_fat_g, sodium_mg),
   food_servings (label, grams, is_default)`;

export async function getFavorites(limit = 30): Promise<CachedFood[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("favorite_foods")
    .select(`food_id, created_at, foods (${FOOD_COLUMNS})`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  // A favourite whose food lost its nutrient row is skipped rather than
  // rendered as a zero-calorie entry.
  return (data ?? []).flatMap((row) => (row.foods ? rowToFood(row.foods) : []));
}

/** The food ids the user has favourited, for marking search results. */
export async function getFavoriteFoodIds(): Promise<Set<number>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("favorite_foods")
    .select("food_id");
  if (error) throw new Error(error.message);

  return new Set((data ?? []).map((r) => r.food_id));
}

/**
 * Adds a favourite. Idempotent — the unique constraint on
 * `(user_id, food_id)` means favouriting twice is not an error.
 */
export async function addFavorite(foodId: number): Promise<void> {
  const userId = await requireUserId();
  const supabase = await createClient();

  const { error } = await supabase
    .from("favorite_foods")
    .upsert({ user_id: userId, food_id: foodId }, { onConflict: "user_id,food_id" });
  if (error) throw new Error(error.message);
}

export async function removeFavorite(foodId: number): Promise<void> {
  await requireUserId();
  const supabase = await createClient();

  // The delete policy keys on auth.uid(), so this cannot reach another
  // user's favourite even with a guessed food id.
  const { error } = await supabase
    .from("favorite_foods")
    .delete()
    .eq("food_id", foodId);
  if (error) throw new Error(error.message);
}

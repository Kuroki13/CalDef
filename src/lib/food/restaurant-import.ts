import "server-only";

import { createCustomFood } from "@/lib/food/custom";
import { restaurantById } from "@/lib/food/restaurant-catalogue";
import { createClient, requireUserId } from "@/lib/supabase/server";

/** Only a catalogue identifier is trusted. Browser nutrition is ignored.
 * Imported references are private custom foods, never shared verified rows.
 */
export async function importRestaurantFood(referenceId: string): Promise<number> {
  const reference = restaurantById(referenceId);
  if (!reference) throw new Error("That restaurant reference is unavailable.");
  const userId = await requireUserId();
  const sourceId = `${referenceId}:${userId}`;
  const db = await createClient();
  const { data, error } = await db.from("foods").select("id, archived_at, description")
    .eq("source", "custom").eq("source_id", sourceId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error("Your food library could not be read.");
  if (data?.archived_at) throw new Error("This food was removed from your library. Create a new custom food to use it again.");
  if (data) {
    if (data.description !== reference.description) throw new Error("You edited this saved food. Select your own version from food search instead.");
    return data.id;
  }

  const serving = reference.servings[0];
  const saved = await createCustomFood({
    name: reference.name, brand: reference.brand, barcode: null,
    basis: "per_100g", servingGrams: serving.grams, servingLabel: serving.label,
    ...reference.nutrients,
    fiber_g: reference.nutrients.fiber_g ?? null,
    sugar_g: reference.nutrients.sugar_g ?? null,
    sat_fat_g: reference.nutrients.sat_fat_g ?? null,
    sodium_mg: reference.nutrients.sodium_mg ?? null,
  }, { sourceId, description: reference.description });
  if ("error" in saved) throw new Error("The restaurant food could not be saved. Try again from your food library.");
  return saved.food.id;
}

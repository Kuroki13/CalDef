import "server-only";

/**
 * A user's own foods.
 *
 * The spec lists custom foods as a search source alongside USDA and Open
 * Food Facts, and the schema has always anticipated them — `foods.user_id`,
 * the `foods_custom_requires_owner` check, and owner-scoped RLS policies for
 * insert, update and delete. What was missing was a way to create one, which
 * is what this module is.
 *
 * It is the *second* writer of `foods`, and the boundary between the two is
 * the ownership column. `cache.ts` writes shared provider rows and never
 * sets `user_id`; this module writes owned rows and always sets it. Neither
 * can produce the other's kind: `cacheFood` refuses a `custom` source
 * outright, and everything here writes `user_id` from the session.
 *
 * Ownership is enforced twice over, and deliberately so. Every statement
 * filters on `user_id`, and the RLS policies would reject a row belonging to
 * someone else even if a filter were forgotten. The filters are not
 * redundant with RLS — they are what turns "the database refused" into "no
 * such food", which is the answer a user should get about a row that is none
 * of their business.
 */

import { randomUUID } from "node:crypto";

import {
  type CustomFoodInput,
  normaliseCustomFood,
} from "@/lib/food/custom-input";
import { rowToFood } from "@/lib/food/cache";
import type { CachedFood } from "@/lib/food/types";
import { createClient, requireUserId } from "@/lib/supabase/server";

/** Everything a `foods` row needs to come back as a `Food`. */
const FOOD_COLUMNS = `id, source, source_id, name, brand, description, barcode,
   is_verified, data_updated_at,
   food_nutrients (kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g,
                   sat_fat_g, sodium_mg),
   food_servings (label, grams, is_default)`;

export type CustomFoodSummary = CachedFood & {
  /** How many diary entries, recipes and saved meals point at this food. */
  useCount: number;
  archivedAt: string | null;
};

/**
 * The owner's foods, newest first, archived ones left out.
 *
 * An archived food is not shown in the library for the same reason it is not
 * shown in search: the user retired it. It stays readable wherever history
 * already refers to it.
 */
export async function listCustomFoods(): Promise<CustomFoodSummary[]> {
  const userId = await requireUserId();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("foods")
    .select(FOOD_COLUMNS)
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);

  const foods = (data ?? []).flatMap(rowToFood);
  if (foods.length === 0) return [];

  const counts = await countUses(foods.map((food) => food.id));

  return foods.map((food) => ({
    ...food,
    useCount: counts.get(food.id) ?? 0,
    archivedAt: null,
  }));
}

/** One of the owner's foods, or null when it is not theirs or not there. */
export async function getCustomFood(id: number): Promise<CachedFood | null> {
  const userId = await requireUserId();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("foods")
    .select(FOOD_COLUMNS)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  return data ? (rowToFood(data)[0] ?? null) : null;
}

/**
 * Creates a food and returns it in the shape the diary logs.
 *
 * Returning the whole food rather than an id is what lets the diary log it
 * immediately: someone creates a food because they are holding the packet
 * and about to eat it, and sending them back to the search box to find what
 * they just typed would be absurd.
 *
 * `source_id` is a uuid rather than null. The column is nullable for custom
 * rows, but the rest of the app identifies a food by `(source, sourceId)` —
 * giving every custom row a stable one keeps it a food like any other
 * instead of a special case that has to be threaded through the logging
 * path.
 */
export async function createCustomFood(
  input: CustomFoodInput,
  reference?: { sourceId: string; description: string | null },
): Promise<{ food: CachedFood } | { error: string }> {
  const normalised = normaliseCustomFood(input);
  if ("error" in normalised) return normalised;

  const userId = await requireUserId();
  const supabase = await createClient();

  const { data: inserted, error: insertError } = await supabase
    .from("foods")
    .insert({
      source: "custom",
      source_id: reference?.sourceId ?? randomUUID(),
      name: normalised.name,
      brand: normalised.brand,
      description: reference?.description ?? null,
      barcode: normalised.barcode,
      is_verified: false,
      user_id: userId,
    })
    .select("id")
    .single();
  if (insertError) return { error: insertError.message };

  const written = await writeNutritionAndServings(inserted.id, normalised);
  if (written) return written;

  const food = await getCustomFood(inserted.id);
  if (!food) return { error: "The food was created but could not be read back." };
  return { food };
}

/**
 * Edits a food. **Past diary entries do not move.**
 *
 * This is the whole reason `food_logs` stores its macros rather than joining
 * to `food_nutrients`: an entry's calories were computed at log time and
 * frozen there, so correcting a label today cannot rewrite what last week's
 * totals said. Nothing in here touches `food_logs`, and nothing should ever
 * be added that does — a "recalculate my history" feature would be a
 * different, explicit thing, not a side effect of fixing a typo.
 *
 * The new figures govern everything from now on: the next time this food is
 * logged, and any portion of an existing entry that is subsequently amended,
 * because amending a portion is a fresh decision that recomputes from what
 * the database now holds.
 */
export async function updateCustomFood(
  id: number,
  input: CustomFoodInput,
): Promise<{ food: CachedFood } | { error: string }> {
  const normalised = normaliseCustomFood(input);
  if ("error" in normalised) return normalised;

  const userId = await requireUserId();
  const supabase = await createClient();

  const { data: owned, error: lookupError } = await supabase
    .from("foods")
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (lookupError) return { error: lookupError.message };
  if (!owned) return { error: "That food is not one of yours." };

  const { error: updateError } = await supabase
    .from("foods")
    .update({
      name: normalised.name,
      brand: normalised.brand,
      barcode: normalised.barcode,
      // After a user edit these are their values, not a published reference.
      description: null,
    })
    .eq("id", id)
    .eq("user_id", userId);
  if (updateError) return { error: updateError.message };

  const written = await writeNutritionAndServings(id, normalised);
  if (written) return written;

  const food = await getCustomFood(id);
  if (!food) return { error: "The food was updated but could not be read back." };
  return { food };
}

export type DeleteOutcome =
  | { deleted: true }
  | { archived: true; useCount: number }
  | { error: string };

/**
 * Removes a food, or retires it when history depends on it.
 *
 * A food nobody has eaten is deleted outright; its nutrition and servings go
 * with it by cascade. A food that has been logged, put in a recipe or saved
 * into a meal is archived instead — the row survives so those references
 * still resolve, and it stops appearing in search.
 *
 * The alternative, deleting the referencing rows too, would mean a tidy-up
 * of the food library silently changing what last month's diary says. That
 * is not a tidy-up; it is data loss with a friendly name.
 */
export async function deleteCustomFood(id: number): Promise<DeleteOutcome> {
  const userId = await requireUserId();
  const supabase = await createClient();

  const { data: owned, error: lookupError } = await supabase
    .from("foods")
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (lookupError) return { error: lookupError.message };
  if (!owned) return { error: "That food is not one of yours." };

  const counts = await countUses([id]);
  const useCount = counts.get(id) ?? 0;

  if (useCount > 0) {
    const { error } = await supabase
      .from("foods")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", userId);
    if (error) return { error: error.message };
    return { archived: true, useCount };
  }

  const { error } = await supabase
    .from("foods")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) return { error: error.message };
  return { deleted: true };
}

/**
 * Writes a food's servings and then its nutrition.
 *
 * That order is deliberate. These are separate statements — PostgREST gives
 * no transaction across them — so if one is going to fail it should fail
 * before anything the user can see has changed. Servings are the only part
 * that can collide with a constraint, so they go first: a rejected edit then
 * leaves the food exactly as it was rather than half-updated. See KNOWN
 * ISSUES for the window this still leaves.
 *
 * Returns an error object or nothing, so callers can `if (result) return
 * result`.
 */
async function writeNutritionAndServings(
  foodId: number,
  normalised: Exclude<ReturnType<typeof normaliseCustomFood>, { error: string }>,
): Promise<{ error: string } | null> {
  const servingError = await writeServings(foodId, normalised.servings);
  if (servingError) return servingError;

  const supabase = await createClient();
  const { error: nutrientError } = await supabase
    .from("food_nutrients")
    .upsert({ food_id: foodId, ...normalised.nutrients }, { onConflict: "food_id" });
  if (nutrientError) return { error: nutrientError.message };

  return null;
}

/**
 * Brings a food's servings to what the label now says.
 *
 * Matched by label rather than replaced wholesale, which is what an earlier
 * version did — and it failed on the second edit of any food with a serving,
 * because `food_servings_food_label_key` is unique on `(food_id, label)` and
 * the row being re-inserted was one a diary entry had pinned in place. The
 * same is true of `food_servings_one_default_idx`, so the default flag is
 * cleared across the food before any row claims it.
 *
 * A serving that an entry, a recipe or a saved meal points at is never
 * deleted: those foreign keys are `on delete set null`, so removing one would
 * quietly turn "1 bar" into a bare gram figure on a row already written.
 * Changing its weight is fine and is the point — the entries that used it
 * carry their own grams, so only future logs move.
 */
async function writeServings(
  foodId: number,
  servings: readonly { label: string; grams: number; isDefault: boolean }[],
): Promise<{ error: string } | null> {
  const supabase = await createClient();

  const { data: existing, error: readError } = await supabase
    .from("food_servings")
    .select("id, label")
    .eq("food_id", foodId);
  if (readError) return { error: readError.message };

  const byLabel = new Map((existing ?? []).map((row) => [row.label, row.id]));

  // Cleared first so that setting a new default cannot collide with the old
  // one on the single-default index.
  if ((existing ?? []).length > 0) {
    const { error } = await supabase
      .from("food_servings")
      .update({ is_default: false })
      .eq("food_id", foodId);
    if (error) return { error: error.message };
  }

  for (const serving of servings) {
    const id = byLabel.get(serving.label);
    const { error } = id
      ? await supabase
          .from("food_servings")
          .update({ grams: serving.grams, is_default: serving.isDefault })
          .eq("id", id)
      : await supabase.from("food_servings").insert({
          food_id: foodId,
          label: serving.label,
          grams: serving.grams,
          is_default: serving.isDefault,
        });
    if (error) return { error: error.message };
  }

  const keepLabels = new Set(servings.map((serving) => serving.label));
  const orphans = (existing ?? []).filter((row) => !keepLabels.has(row.label));
  if (orphans.length === 0) return null;

  const pinned = await pinnedServingIds(orphans.map((row) => row.id));
  const removable = orphans
    .map((row) => row.id)
    .filter((id) => !pinned.has(id));

  if (removable.length > 0) {
    const { error } = await supabase
      .from("food_servings")
      .delete()
      .in("id", removable);
    if (error) return { error: error.message };
  }

  return null;
}

/** Serving ids that something already written points at. */
async function pinnedServingIds(
  ids: readonly number[],
): Promise<Set<number>> {
  const supabase = await createClient();
  const pinned = new Set<number>();
  if (ids.length === 0) return pinned;

  for (const table of [
    "food_logs",
    "recipe_ingredients",
    "saved_meal_items",
  ] as const) {
    const { data, error } = await supabase
      .from(table)
      .select("serving_id")
      .in("serving_id", [...ids]);
    if (error) throw new Error(error.message);

    for (const row of data ?? []) {
      if (row.serving_id !== null) pinned.add(row.serving_id);
    }
  }

  return pinned;
}

/**
 * How many places refer to each food.
 *
 * Counts the three references that are `on delete restrict` — diary entries,
 * recipe ingredients and saved-meal items. Favourites are not counted: that
 * foreign key cascades, so a favourite is a bookmark rather than history and
 * must not be what keeps a food alive.
 */
async function countUses(ids: readonly number[]): Promise<Map<number, number>> {
  const supabase = await createClient();
  const counts = new Map<number, number>();
  if (ids.length === 0) return counts;

  for (const table of [
    "food_logs",
    "recipe_ingredients",
    "saved_meal_items",
  ] as const) {
    const { data, error } = await supabase
      .from(table)
      .select("food_id")
      .in("food_id", [...ids]);
    if (error) throw new Error(error.message);

    for (const row of data ?? []) {
      if (row.food_id === null) continue;
      counts.set(row.food_id, (counts.get(row.food_id) ?? 0) + 1);
    }
  }

  return counts;
}

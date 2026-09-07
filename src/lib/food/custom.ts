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

import {
  type CustomFoodInput,
  normaliseCustomFood,
} from "@/lib/food/custom-input";
import { rowToFood } from "@/lib/food/cache";
import type { CachedFood } from "@/lib/food/types";
import { createClient, requireUserId } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

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
  /**
   * Identity supplied by a caller that has its own notion of one — the
   * restaurant catalogue, which finds a food it imported before by
   * `source_id` and refuses to re-import an edited one.
   */
  reference?: { sourceId: string; description: string | null },
): Promise<{ food: CachedFood } | { error: string }> {
  return saveCustomFood(null, input, reference);
}

/**
 * Edits a food. **Past diary entries do not move.**
 *
 * This is the whole reason `food_logs` stores its macros rather than joining
 * to `food_nutrients`: an entry's calories were computed at log time and
 * frozen there, so correcting a label today cannot rewrite what last week's
 * totals said. The database function this calls writes to no logging table,
 * and nothing should ever be added that does — a "recalculate my history"
 * feature would be a different, explicit thing, not a side effect of fixing
 * a typo.
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
  return saveCustomFood(id, input);
}

/**
 * One food, written in one transaction.
 *
 * The three tables a food lives in used to be three PostgREST round trips
 * with nothing around them, so a failure part-way through left a food with
 * its new name and its old nutrition — which is not hypothetical, it is what
 * the 2026-09-06 deployment verification hit. `save_custom_food` (migration
 * 0009) is a function body, and a function body is a transaction.
 *
 * It is `security invoker`, so this is not a way round the ownership rules:
 * every policy still applies to every statement inside it. That is what lets
 * this code send an id it has not separately checked and trust the answer.
 */
async function saveCustomFood(
  id: number | null,
  input: CustomFoodInput,
  reference?: { sourceId: string; description: string | null },
): Promise<{ food: CachedFood } | { error: string }> {
  const normalised = normaliseCustomFood(input);
  if ("error" in normalised) return normalised;

  const supabase = await createClient();

  // The generated `Args` type is not quite the function's signature: the
  // type generator emits each parameter's base type and drops nullability,
  // while this function takes null for the id of a food being created and
  // for a brand, a barcode and a reference that were not given. The cast is
  // here rather than in `types/database.ts` because that file is generated
  // and an edit to it would be lost on the next regeneration.
  const args = {
    p_food_id: id,
    p_name: normalised.name,
    p_brand: normalised.brand,
    p_barcode: normalised.barcode,
    p_nutrients: normalised.nutrients,
    p_servings: normalised.servings,
    p_source_id: reference?.sourceId ?? null,
    p_description: reference?.description ?? null,
  } as unknown as Database["public"]["Functions"]["save_custom_food"]["Args"];

  const { data: foodId, error } = await supabase.rpc("save_custom_food", args);

  if (error) return { error: describeSaveFailure(error.message) };
  if (typeof foodId !== "number") {
    return { error: "The food could not be saved." };
  }

  const food = await getCustomFood(foodId);
  if (!food) return { error: "The food was saved but could not be read back." };
  return { food };
}

/**
 * Turns a database error into something worth reading.
 *
 * Only two of these are reachable from the app, because `custom-input.ts`
 * refuses impossible figures before they get here — but a constraint message
 * quoting `food_nutrients_kcal_check` is no use to anyone, and the ownership
 * message is one the user should see exactly as written.
 */
function describeSaveFailure(message: string): string {
  if (message.includes("not one of yours")) return "That food is not one of yours.";
  if (message.includes("row-level security") || message.includes("permission denied")) {
    return "That food is not one of yours.";
  }
  if (message.includes("_check")) {
    return "Those figures are outside what a food can be. Check the panel you copied.";
  }
  return message;
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

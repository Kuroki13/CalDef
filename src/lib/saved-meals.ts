import "server-only";

/**
 * Saved meals — a reusable grouping of foods (spec §7).
 *
 * A saved meal is *not* a recipe. A recipe is a composed dish that logs as
 * one diary entry (`food_logs.recipe_id`); a saved meal is a set of separate
 * foods that logs as several, one per item. The `food_logs` XOR constraint
 * between `food_id` and `recipe_id` is what makes that distinction
 * structural rather than a convention.
 */

import { type MealOverrides, applyOverrides } from "@/lib/meal-template";
import { type MacroTotals, scaleNutrients, sumMacros } from "@/lib/nutrition/macros";
import { createClient, requireUserId } from "@/lib/supabase/server";
import type { Tables } from "@/types/database";

export type SavedMeal = Tables<"saved_meals">;

export type SavedMealItem = {
  id: number;
  foodId: number;
  foodName: string;
  foodBrand: string | null;
  servingId: number | null;
  servingLabel: string | null;
  amount: number;
  unit: "g" | "ml" | "serving";
  grams: number;
  macros: MacroTotals;
};

export type SavedMealDetail = {
  meal: SavedMeal;
  items: SavedMealItem[];
  totals: MacroTotals;
};

const ITEM_SELECT = `id, food_id, serving_id, amount, unit, grams, sort_order,
   foods ( name, brand, food_nutrients ( kcal, protein_g, carbs_g, fat_g ) ),
   food_servings ( label )`;

export async function listSavedMeals(): Promise<SavedMealDetail[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("saved_meals")
    .select(`*, saved_meal_items (${ITEM_SELECT})`)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const items = toItems(row.saved_meal_items ?? []);
    return {
      meal: row as SavedMeal,
      items,
      totals: sumMacros(items.map((i) => i.macros)),
    };
  });
}

export async function getSavedMeal(id: number): Promise<SavedMealDetail | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("saved_meals")
    .select(`*, saved_meal_items (${ITEM_SELECT})`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const items = toItems(data.saved_meal_items ?? []);
  return {
    meal: data as SavedMeal,
    items,
    totals: sumMacros(items.map((i) => i.macros)),
  };
}

/**
 * Creates a saved meal from entries already in the diary.
 *
 * Built from logged entries rather than from a fresh search, because that is
 * how the need actually arises: you eat the same breakfast three days
 * running and want it back as one action.
 */
export async function createSavedMealFromEntries(
  name: string,
  entryIds: readonly number[],
  defaultMealTypeId: number | null,
): Promise<{ id: number } | { error: string }> {
  if (entryIds.length === 0) return { error: "Pick at least one entry." };

  const userId = await requireUserId();
  const supabase = await createClient();

  const { data: entries, error: entriesError } = await supabase
    .from("food_logs")
    .select("food_id, serving_id, amount, unit, grams")
    .in("id", [...entryIds]);
  if (entriesError) return { error: entriesError.message };

  // A recipe-backed entry has no food_id and cannot become a saved-meal item.
  const usable = (entries ?? []).filter((e) => e.food_id !== null);
  if (usable.length === 0) {
    return { error: "Those entries cannot be saved as a meal." };
  }

  const { data: meal, error } = await supabase
    .from("saved_meals")
    .insert({
      user_id: userId,
      name: name.trim(),
      default_meal_type_id: defaultMealTypeId,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  const { error: itemsError } = await supabase.from("saved_meal_items").insert(
    usable.map((e, index) => ({
      saved_meal_id: meal.id,
      food_id: e.food_id!,
      serving_id: e.serving_id,
      amount: e.amount,
      unit: e.unit,
      // A food row always has a weight (food_logs_grams_unless_estimate).
      grams: Number(e.grams),
      sort_order: index,
    })),
  );
  if (itemsError) return { error: itemsError.message };

  return { id: meal.id };
}

/**
 * Logs a saved meal into a day, one `food_logs` row per item.
 *
 * Macros are recomputed from the stored nutrient rows rather than copied
 * from the saved meal, so an entry is always derived from what the database
 * holds at the moment of logging.
 */
export async function logSavedMeal(
  savedMealId: number,
  logDate: string,
  mealTypeId: number,
  /**
   * This log's changes — an item left out, a different amount (§12F). The
   * saved meal itself is not touched. Null logs it exactly as saved.
   */
  overrides: MealOverrides | null = null,
): Promise<{ logged: number } | { error: string }> {
  const userId = await requireUserId();
  const supabase = await createClient();

  const detail = await getSavedMeal(savedMealId);
  if (!detail) return { error: "That saved meal no longer exists." };
  if (detail.items.length === 0) return { error: "That saved meal is empty." };

  const adjusted = applyOverrides(detail.items, overrides);
  if ("error" in adjusted) return adjusted;

  // Still one insert, so a template with changes is as all-or-nothing as
  // one without.
  const { error } = await supabase.from("food_logs").insert(
    adjusted.items.map((item) => ({
      user_id: userId,
      log_date: logDate,
      meal_type_id: mealTypeId,
      food_id: item.foodId,
      serving_id: item.servingId,
      amount: item.amount,
      unit: item.unit,
      grams: item.grams,
      kcal: item.macros.kcal,
      protein_g: item.macros.protein_g,
      carbs_g: item.macros.carbs_g,
      fat_g: item.macros.fat_g,
      source: "saved_meal" as const,
    })),
  );
  if (error) return { error: error.message };

  return { logged: adjusted.items.length };
}

export async function deleteSavedMeal(id: number): Promise<void> {
  await requireUserId();
  const supabase = await createClient();
  await supabase.from("saved_meals").delete().eq("id", id);
}

type ItemRow = {
  id: number;
  food_id: number;
  serving_id: number | null;
  amount: number;
  unit: string;
  grams: number;
  sort_order: number;
  foods: {
    name: string;
    brand: string | null;
    food_nutrients: {
      kcal: number;
      protein_g: number;
      carbs_g: number;
      fat_g: number;
    } | null;
  } | null;
  food_servings: { label: string } | null;
};

function toItems(rows: readonly ItemRow[]): SavedMealItem[] {
  return [...rows]
    .sort((a, b) => a.sort_order - b.sort_order)
    .flatMap((row) => {
      const nutrients = row.foods?.food_nutrients;
      // Skip an item whose food lost its nutrition rather than logging zero.
      if (!nutrients) return [];

      return [
        {
          id: row.id,
          foodId: row.food_id,
          foodName: row.foods?.name ?? "Food",
          foodBrand: row.foods?.brand ?? null,
          servingId: row.serving_id,
          servingLabel: row.food_servings?.label ?? null,
          amount: Number(row.amount),
          unit: row.unit as SavedMealItem["unit"],
          grams: Number(row.grams),
          macros: scaleNutrients(
            {
              kcal: Number(nutrients.kcal),
              protein_g: Number(nutrients.protein_g),
              carbs_g: Number(nutrients.carbs_g),
              fat_g: Number(nutrients.fat_g),
            },
            Number(row.grams),
          ),
        },
      ];
    });
}

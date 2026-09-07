import "server-only";

/**
 * Recipes — a composed dish (spec §7).
 *
 * A recipe logs as a *single* diary entry carrying `food_logs.recipe_id`,
 * because that is what it is to the person eating it: one thing, not a list
 * of ingredients. Saved meals take the other path and expand into several
 * rows. The XOR constraint between `food_id` and `recipe_id` keeps the two
 * from blurring.
 *
 * Nutrition is computed from the ingredients' stored nutrient rows and
 * divided by the recipe's serving count, so the LLM-never-computes-calories
 * rule holds here as it does everywhere else.
 */

import { cacheFood } from "@/lib/food/cache";
import type { Food } from "@/lib/food/types";
import {
  type MacroTotals,
  multiplyMacros,
  scaleNutrients,
  sumMacros,
} from "@/lib/nutrition/macros";
import { toGrams } from "@/lib/nutrition/units";
import { createClient, requireUserId } from "@/lib/supabase/server";
import type { Tables } from "@/types/database";

export type Recipe = Tables<"recipes">;

export type RecipeIngredient = {
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

export type RecipeDetail = {
  recipe: Recipe;
  ingredients: RecipeIngredient[];
  /** For the whole recipe as made. */
  totals: MacroTotals;
  /** Totals divided by `servings` — what one portion costs. */
  perServing: MacroTotals;
};

const INGREDIENT_SELECT = `id, food_id, serving_id, amount, unit, grams, sort_order,
   foods ( name, brand, food_nutrients ( kcal, protein_g, carbs_g, fat_g ) ),
   food_servings ( label )`;

export async function listRecipes(): Promise<RecipeDetail[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("recipes")
    .select(`*, recipe_ingredients (${INGREDIENT_SELECT})`)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) =>
    toDetail(row as Recipe, row.recipe_ingredients ?? []),
  );
}

export async function getRecipe(id: number): Promise<RecipeDetail | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("recipes")
    .select(`*, recipe_ingredients (${INGREDIENT_SELECT})`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);

  return data ? toDetail(data as Recipe, data.recipe_ingredients ?? []) : null;
}

export async function createRecipe(
  name: string,
  servings: number,
  notes: string | null,
): Promise<{ id: number } | { error: string }> {
  const userId = await requireUserId();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("recipes")
    .insert({ user_id: userId, name: name.trim(), servings, notes })
    .select("id")
    .single();
  if (error) return { error: error.message };

  return { id: data.id };
}

/**
 * Adds an ingredient by copying an existing diary entry's food and portion.
 *
 * Reuses the same resolution the diary already did rather than re-searching,
 * so a recipe is built from foods that are already cached and already have
 * nutrient rows.
 */
export async function addIngredientsFromEntries(
  recipeId: number,
  entryIds: readonly number[],
): Promise<{ added: number } | { error: string }> {
  if (entryIds.length === 0) return { error: "Pick at least one entry." };

  await requireUserId();
  const supabase = await createClient();

  const { data: entries, error } = await supabase
    .from("food_logs")
    .select("food_id, serving_id, amount, unit, grams")
    .in("id", [...entryIds]);
  if (error) return { error: error.message };

  const usable = (entries ?? []).filter((e) => e.food_id !== null);
  if (usable.length === 0) {
    return { error: "Those entries cannot be used as ingredients." };
  }

  const { data: existing } = await supabase
    .from("recipe_ingredients")
    .select("sort_order")
    .eq("recipe_id", recipeId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const base = (existing?.sort_order ?? -1) + 1;

  const { error: insertError } = await supabase
    .from("recipe_ingredients")
    .insert(
      usable.map((e, index) => ({
        recipe_id: recipeId,
        food_id: e.food_id!,
        serving_id: e.serving_id,
        amount: e.amount,
        unit: e.unit,
        grams: e.grams,
        sort_order: base + index,
      })),
    );
  if (insertError) return { error: insertError.message };

  return { added: usable.length };
}

export type RecipeIngredientInput = {
  /** A resolved provider food, exactly as the search box hands one over. */
  food: Food;
  amount: number;
  unit: "g" | "ml" | "serving";
  /** Only consulted for a serving amount, which needs a weight behind it. */
  servingLabel?: string | null;
};

export type CreateRecipeInput = {
  name: string;
  servings: number;
  notes: string | null;
  ingredients: readonly RecipeIngredientInput[];
  /** Set when a model proposed the ingredient list. Provenance, not licence. */
  aiDrafted?: boolean;
};

/**
 * Builds a recipe from foods that have already been resolved.
 *
 * The counterpart to `addIngredientsFromEntries`, for the case where the
 * ingredients came from a search rather than from yesterday's diary — which
 * is what an AI-drafted recipe is: a list of search terms that were looked
 * up against the real providers and confirmed by the person who cooked it.
 *
 * Each food is cached first, so an ingredient references a `foods` row with
 * a nutrient row behind it. That is the whole reason nothing here has to
 * trust the caller's numbers: `getRecipe` recomputes every macro from those
 * rows, so the amounts are the only thing this function is really writing.
 *
 * A drafted recipe is a *private* recipe like any other. Nothing here writes
 * to the shared food cache except through `cacheFood`, which stores what the
 * providers themselves returned — never a figure a model produced, because
 * a model never produced one.
 */
export async function createRecipeFromFoods(
  input: CreateRecipeInput,
): Promise<{ id: number } | { error: string }> {
  if (input.ingredients.length === 0) {
    return { error: "A recipe needs at least one ingredient." };
  }

  const userId = await requireUserId();
  const supabase = await createClient();

  // Resolved before the recipe row exists, so a failure to weigh an
  // ingredient does not leave an empty recipe behind.
  const rows: {
    food_id: number;
    serving_id: number | null;
    amount: number;
    unit: RecipeIngredientInput["unit"];
    grams: number;
  }[] = [];

  for (const ingredient of input.ingredients) {
    const foodId = await cacheFood(ingredient.food);

    const serving =
      ingredient.unit === "serving"
        ? (ingredient.food.servings.find(
            (s) => s.label === ingredient.servingLabel,
          ) ??
          ingredient.food.servings.find((s) => s.isDefault) ??
          ingredient.food.servings[0] ??
          null)
        : null;

    if (ingredient.unit === "serving" && !serving) {
      return {
        error: `${ingredient.food.name} has no serving weight. Give it in grams instead.`,
      };
    }

    let grams: number;
    try {
      grams = toGrams({
        amount: ingredient.amount,
        unit: ingredient.unit,
        serving: serving ? { grams: serving.grams } : null,
      });
    } catch {
      return { error: `${ingredient.food.name} has no usable amount.` };
    }

    // The serving row's own id, which the ingredient points at so the recipe
    // reads back as "1 bar" rather than a bare gram figure.
    const { data: servingRow } = serving
      ? await supabase
          .from("food_servings")
          .select("id")
          .eq("food_id", foodId)
          .eq("label", serving.label)
          .maybeSingle()
      : { data: null };

    rows.push({
      food_id: foodId,
      serving_id: servingRow?.id ?? null,
      amount: ingredient.amount,
      unit: ingredient.unit,
      grams,
    });
  }

  const { data: recipe, error: recipeError } = await supabase
    .from("recipes")
    .insert({
      user_id: userId,
      name: input.name.trim(),
      servings: input.servings,
      notes: input.notes,
      ai_drafted_at: input.aiDrafted ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (recipeError) return { error: recipeError.message };

  const { error: ingredientError } = await supabase
    .from("recipe_ingredients")
    .insert(
      rows.map((row, index) => ({ ...row, recipe_id: recipe.id, sort_order: index })),
    );
  if (ingredientError) {
    // The recipe exists but is empty, which is worse than nothing: remove it
    // rather than leaving a name with no ingredients under it.
    await supabase.from("recipes").delete().eq("id", recipe.id);
    return { error: ingredientError.message };
  }

  return { id: recipe.id };
}

export async function removeIngredient(ingredientId: number): Promise<void> {
  await requireUserId();
  const supabase = await createClient();
  await supabase.from("recipe_ingredients").delete().eq("id", ingredientId);
}

export async function deleteRecipe(id: number): Promise<void> {
  await requireUserId();
  const supabase = await createClient();
  await supabase.from("recipes").delete().eq("id", id);
}

/**
 * Logs a number of servings of a recipe as one diary entry.
 *
 * `grams` on the row is the real weight of the portion eaten, so the diary's
 * gram figures stay meaningful even for a composed dish.
 */
export async function logRecipe(
  recipeId: number,
  logDate: string,
  mealTypeId: number,
  servings: number,
): Promise<{ ok: true } | { error: string }> {
  const userId = await requireUserId();
  const supabase = await createClient();

  const detail = await getRecipe(recipeId);
  if (!detail) return { error: "That recipe no longer exists." };
  if (detail.ingredients.length === 0) {
    return { error: "That recipe has no ingredients yet." };
  }

  const macros = multiplyMacros(detail.perServing, servings);
  const totalGrams = detail.ingredients.reduce((sum, i) => sum + i.grams, 0);
  const gramsPerServing = totalGrams / Number(detail.recipe.servings);
  const grams = Math.max(gramsPerServing * servings, 0.001);

  const { error } = await supabase.from("food_logs").insert({
    user_id: userId,
    log_date: logDate,
    meal_type_id: mealTypeId,
    recipe_id: recipeId,
    amount: servings,
    unit: "serving" as const,
    grams,
    kcal: macros.kcal,
    protein_g: macros.protein_g,
    carbs_g: macros.carbs_g,
    fat_g: macros.fat_g,
    source: "recipe" as const,
    notes: detail.recipe.name,
  });
  if (error) return { error: error.message };

  return { ok: true };
}

type IngredientRow = {
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

function toDetail(recipe: Recipe, rows: readonly IngredientRow[]): RecipeDetail {
  const ingredients = [...rows]
    .sort((a, b) => a.sort_order - b.sort_order)
    .flatMap((row) => {
      const nutrients = row.foods?.food_nutrients;
      if (!nutrients) return [];

      return [
        {
          id: row.id,
          foodId: row.food_id,
          foodName: row.foods?.name ?? "Ingredient",
          foodBrand: row.foods?.brand ?? null,
          servingId: row.serving_id,
          servingLabel: row.food_servings?.label ?? null,
          amount: Number(row.amount),
          unit: row.unit as RecipeIngredient["unit"],
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

  const totals = sumMacros(ingredients.map((i) => i.macros));
  const servings = Number(recipe.servings) || 1;

  return {
    recipe,
    ingredients,
    totals,
    perServing: multiplyMacros(totals, 1 / servings),
  };
}

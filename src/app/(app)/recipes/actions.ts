"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { addFavorite, removeFavorite } from "@/lib/favorites";
import { logCachedFood } from "@/lib/food-log";
import {
  addIngredientsFromEntries,
  createRecipe,
  deleteRecipe,
  logRecipe,
  removeIngredient,
  updateRecipeSettings,
} from "@/lib/recipes";
import { overridesFromForm } from "@/lib/meal-template";
import {
  createSavedMealFromEntries,
  deleteSavedMeal,
  logSavedMeal,
} from "@/lib/saved-meals";

export type LibraryState = { error?: string; ok?: boolean; notice?: string };

/** Both screens show a target, so both are invalidated on every change. */
function revalidateAll(): void {
  revalidatePath("/recipes");
  revalidatePath("/diary");
  revalidatePath("/dashboard");
}

const idList = z
  .string()
  .transform((raw) =>
    raw
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((n) => Number.isInteger(n) && n > 0),
  );

const createRecipeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  servings: z.coerce.number().positive().max(1000),
  notes: z.string().trim().max(1000).optional(),
  entryIds: idList.optional(),
});

export async function createRecipeAction(
  _prev: LibraryState,
  formData: FormData,
): Promise<LibraryState> {
  const parsed = createRecipeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Give the recipe a name and servings." };

  const created = await createRecipe(
    parsed.data.name,
    parsed.data.servings,
    parsed.data.notes || null,
  );
  if ("error" in created) return { error: created.error };

  if (parsed.data.entryIds?.length) {
    const added = await addIngredientsFromEntries(
      created.id,
      parsed.data.entryIds,
    );
    if ("error" in added) {
      // The recipe exists; only the ingredients failed. Say so precisely
      // rather than implying nothing was created.
      return {
        ok: true,
        notice: `Recipe created, but its ingredients could not be added: ${added.error}`,
      };
    }
  }

  revalidateAll();
  return { ok: true };
}

const logRecipeSchema = z.object({
  recipeId: z.coerce.number().int().positive(),
  logDate: z.iso.date(),
  mealTypeId: z.coerce.number().int().positive(),
  /** Servings, or grams when `unit` says so. */
  servings: z.coerce.number().positive().max(100000),
  unit: z.enum(["serving", "g"]).optional().default("serving"),
});

export async function logRecipeAction(
  _prev: LibraryState,
  formData: FormData,
): Promise<LibraryState> {
  const parsed = logRecipeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Check the servings and meal." };

  if (parsed.data.unit === "serving" && parsed.data.servings > 100) {
    return { error: "That is more servings than a recipe makes. Did you mean grams?" };
  }
  const result = await logRecipe(
    parsed.data.recipeId,
    parsed.data.logDate,
    parsed.data.mealTypeId,
    { amount: parsed.data.servings, unit: parsed.data.unit },
  );
  if ("error" in result) return { error: result.error };

  revalidateAll();
  return { ok: true, notice: "Added to your diary." };
}

export async function deleteRecipeAction(formData: FormData): Promise<void> {
  const id = Number(formData.get("recipeId"));
  if (!Number.isInteger(id) || id <= 0) return;
  await deleteRecipe(id);
  revalidateAll();
}

export async function removeIngredientAction(
  formData: FormData,
): Promise<void> {
  const id = Number(formData.get("ingredientId"));
  if (!Number.isInteger(id) || id <= 0) return;
  await removeIngredient(id);
  revalidateAll();
}

const addIngredientsSchema = z.object({
  recipeId: z.coerce.number().int().positive(),
  entryIds: idList,
});

/**
 * Adds today's diary entries to a recipe that already exists.
 *
 * Without this a recipe could only ever receive ingredients in the moment it
 * was created — an empty one was a dead end, and a recipe whose ingredients
 * had all been removed could not be rebuilt.
 *
 * Ownership is not checked here: `recipe_ingredients`' insert policy keys on
 * the parent recipe's `user_id`, so a forged `recipeId` fails at the
 * database rather than relying on this layer to notice.
 */
export async function addIngredientsAction(
  _prev: LibraryState,
  formData: FormData,
): Promise<LibraryState> {
  const parsed = addIngredientsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Pick at least one entry to add." };

  const added = await addIngredientsFromEntries(
    parsed.data.recipeId,
    parsed.data.entryIds,
  );
  if ("error" in added) return { error: added.error };

  revalidateAll();
  return {
    ok: true,
    notice: `Added ${added.added} ingredient${added.added === 1 ? "" : "s"}.`,
  };
}

const logFavoriteSchema = z.object({
  foodId: z.coerce.number().int().positive(),
  logDate: z.iso.date(),
  mealTypeId: z.coerce.number().int().positive(),
  grams: z.coerce.number().positive().max(100000),
});

/**
 * Logs a starred food straight to the diary.
 *
 * The point of a favourite is to skip the search, so this takes a food id
 * that is already cached rather than a provider payload. `logCachedFood`
 * still computes the macros from the stored nutrient row, so this path is
 * no more trusted than the manual one.
 *
 * The amount is in grams because that is the figure the favourites list
 * shows (kcal per 100 g); offering servings here would mean rendering a
 * serving picker per row for a screen whose whole purpose is one action.
 */
export async function logFavoriteAction(
  _prev: LibraryState,
  formData: FormData,
): Promise<LibraryState> {
  const parsed = logFavoriteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Check the amount and meal." };

  const result = await logCachedFood({
    foodId: parsed.data.foodId,
    logDate: parsed.data.logDate,
    mealTypeId: parsed.data.mealTypeId,
    amount: parsed.data.grams,
    unit: "g",
    source: "favorite",
  });
  if ("error" in result) return { error: result.error };

  revalidateAll();
  return { ok: true, notice: "Added to your diary." };
}

const createSavedMealSchema = z.object({
  name: z.string().trim().min(1).max(120),
  entryIds: idList,
  defaultMealTypeId: z.coerce.number().int().positive().optional(),
});

export async function createSavedMealAction(
  _prev: LibraryState,
  formData: FormData,
): Promise<LibraryState> {
  const parsed = createSavedMealSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: "Give the meal a name and pick at least one entry." };
  }

  const created = await createSavedMealFromEntries(
    parsed.data.name,
    parsed.data.entryIds,
    parsed.data.defaultMealTypeId ?? null,
  );
  if ("error" in created) return { error: created.error };

  revalidateAll();
  return { ok: true };
}

const logSavedMealSchema = z.object({
  savedMealId: z.coerce.number().int().positive(),
  logDate: z.iso.date(),
  mealTypeId: z.coerce.number().int().positive(),
});

export async function logSavedMealAction(
  _prev: LibraryState,
  formData: FormData,
): Promise<LibraryState> {
  const parsed = logSavedMealSchema.safeParse({
    savedMealId: formData.get("savedMealId"),
    logDate: formData.get("logDate"),
    mealTypeId: formData.get("mealTypeId"),
  });
  if (!parsed.success) return { error: "Check the meal and date." };

  const result = await logSavedMeal(
    parsed.data.savedMealId,
    parsed.data.logDate,
    parsed.data.mealTypeId,
    overridesFromForm(formData),
  );
  if ("error" in result) return { error: result.error };

  revalidateAll();
  return {
    ok: true,
    notice: `Added ${result.logged} item${result.logged === 1 ? "" : "s"} to your diary.`,
  };
}

export async function deleteSavedMealAction(formData: FormData): Promise<void> {
  const id = Number(formData.get("savedMealId"));
  if (!Number.isInteger(id) || id <= 0) return;
  await deleteSavedMeal(id);
  revalidateAll();
}

/** Toggling a favourite is one action so the button has one behaviour. */
export async function toggleFavoriteAction(formData: FormData): Promise<void> {
  const foodId = Number(formData.get("foodId"));
  if (!Number.isInteger(foodId) || foodId <= 0) return;

  if (formData.get("favorite") === "true") {
    await removeFavorite(foodId);
  } else {
    await addFavorite(foodId);
  }

  revalidateAll();
}

const recipeSettingsSchema = z.object({
  recipeId: z.coerce.number().int().positive(),
  isFamily: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
  cookedWeightG: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : v),
    z.coerce.number().positive().max(100000).nullable(),
  ),
});

/**
 * A recipe's family mark and cooked weight (§13H, §13G). The weight is
 * what lets "450 g" of the dish be logged; leaving it blank keeps the
 * recipe to servings, which is honest when it was never weighed.
 */
export async function updateRecipeSettingsAction(
  _prev: LibraryState,
  formData: FormData,
): Promise<LibraryState> {
  const parsed = recipeSettingsSchema.safeParse({
    recipeId: formData.get("recipeId"),
    isFamily: formData.get("isFamily"),
    cookedWeightG: formData.get("cookedWeightG"),
  });
  if (!parsed.success) return { error: "The cooked weight must be a number of grams above zero." };

  const result = await updateRecipeSettings(parsed.data.recipeId, {
    isFamily: parsed.data.isFamily,
    cookedWeightG: parsed.data.cookedWeightG,
  });
  if ("error" in result) return { error: result.error };

  revalidateAll();
  return { ok: true, notice: "Saved." };
}

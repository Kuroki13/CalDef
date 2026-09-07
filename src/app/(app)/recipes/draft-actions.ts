"use server";

/**
 * Saving a recipe whose ingredient list a model drafted.
 *
 * What arrives here is not a model response. It is a list of foods that came
 * back from USDA, Open Food Facts or the cache, with amounts the owner
 * looked at and kept or changed — the model's contribution ended when the
 * search terms were resolved. So this action does what the manual recipe
 * form does, and the only thing that reaches the database differently is
 * `recipes.ai_drafted_at`, which records how the list was arrived at.
 *
 * An ingredient the providers could not resolve cannot reach this action at
 * all: the payload's shape requires a resolved food for every item, so an
 * unmatched one has to be replaced or dropped in the review. That is the
 * difference between "estimated ingredient list" and "estimated nutrition",
 * and it is enforced by what this function will accept rather than by asking
 * the UI nicely.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { foodPayloadSchema } from "@/lib/food/payload";
import type { Food } from "@/lib/food/types";
import { createRecipeFromFoods } from "@/lib/recipes";
import { getUserId } from "@/lib/supabase/server";

export type RecipeDraftState = { error?: string; ok?: boolean; notice?: string };

const ingredientSchema = z.object({
  food: foodPayloadSchema,
  amount: z.coerce.number().positive().max(100000),
  unit: z.enum(["g", "ml", "serving"]),
  servingLabel: z.string().trim().max(120).nullable().optional(),
});

const payloadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  servings: z.coerce.number().positive().max(1000),
  // The same cap the drafting side uses, plus room for the ones the owner
  // added by hand during the review.
  ingredients: z.array(ingredientSchema).min(1).max(20),
  aiDrafted: z.boolean().default(false),
});

export async function saveDraftedRecipe(
  _prev: RecipeDraftState,
  formData: FormData,
): Promise<RecipeDraftState> {
  if (!(await getUserId())) {
    return { error: "Please sign in before saving a recipe." };
  }

  let payload: z.infer<typeof payloadSchema>;
  try {
    payload = payloadSchema.parse(
      JSON.parse(String(formData.get("payload") ?? "")),
    );
  } catch {
    return { error: "That recipe could not be read. Try describing it again." };
  }

  const created = await createRecipeFromFoods({
    name: payload.name,
    servings: payload.servings,
    notes: null,
    aiDrafted: payload.aiDrafted,
    ingredients: payload.ingredients.map((ingredient) => ({
      food: ingredient.food as Food,
      amount: ingredient.amount,
      unit: ingredient.unit,
      servingLabel: ingredient.servingLabel ?? null,
    })),
  });
  if ("error" in created) return { error: created.error };

  revalidatePath("/recipes");
  revalidatePath("/diary");

  return {
    ok: true,
    notice: `${payload.name} saved to your recipes. Its nutrition is computed from the ingredients you confirmed.`,
  };
}

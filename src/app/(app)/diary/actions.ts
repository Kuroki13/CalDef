"use server";

/**
 * Logging, editing and deleting diary entries.
 *
 * This is the convergence point ARCHITECTURE §4 describes: the manual path
 * and the AI path both arrive here, and the nutrition numbers are computed
 * from a cached `food_nutrients` row in every case. Nothing upstream — a
 * provider payload, a model response, a form field — is permitted to supply
 * a calorie figure.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { cacheFood } from "@/lib/food/cache";
import { foodPayloadSchema } from "@/lib/food/payload";
import { logCachedFood } from "@/lib/food-log";
import type { Food } from "@/lib/food/types";
import { scaleNutrients } from "@/lib/nutrition/macros";
import { createClient, requireUserId } from "@/lib/supabase/server";

export type DiaryActionState = { error?: string; ok?: boolean };

const logSchema = z.object({
  logDate: z.iso.date(),
  mealTypeId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive().max(100000),
  unit: z.enum(["g", "ml", "serving"]),
  /** The chosen serving, when the amount is expressed in servings. */
  servingLabel: z.string().trim().max(120).optional(),
  /** The provider food, serialised by the search UI. */
  food: z.string().min(2),
});

export async function logFood(
  _prev: DiaryActionState,
  formData: FormData,
): Promise<DiaryActionState> {
  const parsed = logSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  let food: Food;
  try {
    food = foodPayloadSchema.parse(JSON.parse(parsed.data.food)) as Food;
  } catch {
    return { error: "That food could not be read. Search for it again." };
  }

  // Cache first, so the entry references a real row and the same food is not
  // fetched from a provider again next time.
  const foodId = await cacheFood(food);

  // From here the payload is finished with. `logCachedFood` recomputes the
  // macros from the stored nutrient row, so whatever the client sent cannot
  // reach the diary as a calorie figure.
  const result = await logCachedFood({
    foodId,
    logDate: parsed.data.logDate,
    mealTypeId: parsed.data.mealTypeId,
    amount: parsed.data.amount,
    unit: parsed.data.unit,
    servingLabel: parsed.data.servingLabel,
    source: "manual",
  });
  if ("error" in result) return result;

  revalidatePath("/diary");
  revalidatePath("/dashboard");
  return { ok: true };
}

const amendSchema = z.object({
  entryId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive().max(100000),
});

/**
 * Changes the amount of an existing entry, recomputing its macros.
 *
 * The stored `grams` is scaled by the ratio of new to old amount, which
 * preserves whatever serving the entry was originally logged against without
 * having to resolve it again.
 */
export async function updateEntryAmount(
  _prev: DiaryActionState,
  formData: FormData,
): Promise<DiaryActionState> {
  const parsed = amendSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter a valid amount." };

  await requireUserId();
  const supabase = await createClient();

  const { data: entry, error } = await supabase
    .from("food_logs")
    .select("id, amount, grams, food_id")
    .eq("id", parsed.data.entryId)
    .maybeSingle();
  if (error) return { error: error.message };
  // RLS makes another user's entry invisible, so this covers both "gone" and
  // "not yours" without leaking which.
  if (!entry) return { error: "That entry no longer exists." };

  const previousAmount = Number(entry.amount);
  if (previousAmount <= 0) return { error: "That entry cannot be amended." };

  const grams = (Number(entry.grams) / previousAmount) * parsed.data.amount;

  const { data: nutrients } = await supabase
    .from("food_nutrients")
    .select("kcal, protein_g, carbs_g, fat_g")
    .eq("food_id", entry.food_id!)
    .single();
  if (!nutrients) return { error: "That food has no nutrition data." };

  const macros = scaleNutrients(
    {
      kcal: Number(nutrients.kcal),
      protein_g: Number(nutrients.protein_g),
      carbs_g: Number(nutrients.carbs_g),
      fat_g: Number(nutrients.fat_g),
    },
    grams,
  );

  const { error: updateError } = await supabase
    .from("food_logs")
    .update({
      amount: parsed.data.amount,
      grams,
      kcal: macros.kcal,
      protein_g: macros.protein_g,
      carbs_g: macros.carbs_g,
      fat_g: macros.fat_g,
    })
    .eq("id", parsed.data.entryId);
  if (updateError) return { error: updateError.message };

  revalidatePath("/diary");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteEntry(formData: FormData): Promise<void> {
  const entryId = Number(formData.get("entryId"));
  if (!Number.isInteger(entryId) || entryId <= 0) return;

  await requireUserId();
  const supabase = await createClient();

  // No ownership filter needed: the delete policy keys on auth.uid(), so a
  // request for someone else's entry affects nothing.
  await supabase.from("food_logs").delete().eq("id", entryId);

  revalidatePath("/diary");
  revalidatePath("/dashboard");
}

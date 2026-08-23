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
import type { Food } from "@/lib/food/types";
import { scaleNutrients } from "@/lib/nutrition/macros";
import { toGrams } from "@/lib/nutrition/units";
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

/**
 * The shape the client sends back for a chosen search result.
 *
 * Validated rather than trusted: it arrives from the browser, so it is
 * re-parsed here before anything is written. Note that the nutrient values
 * it carries are used only to *populate the cache* on first sight — the
 * entry's own macros are then computed from what the database holds, so a
 * tampered payload cannot inflate a diary entry beyond what it also wrote
 * into the shared cache.
 */
const foodSchema = z.object({
  sourceId: z.string().min(1).max(200),
  source: z.enum(["usda", "off", "custom"]),
  name: z.string().trim().min(1).max(300),
  brand: z.string().trim().max(200).nullable(),
  description: z.string().trim().max(500).nullable(),
  barcode: z.string().regex(/^[0-9]{6,14}$/).nullable(),
  isVerified: z.boolean(),
  nutrients: z.object({
    kcal: z.number().min(0).max(1000),
    protein_g: z.number().min(0).max(100),
    carbs_g: z.number().min(0).max(100),
    fat_g: z.number().min(0).max(100),
    fiber_g: z.number().min(0).max(100).nullable().optional(),
    sugar_g: z.number().min(0).max(100).nullable().optional(),
    sat_fat_g: z.number().min(0).max(100).nullable().optional(),
    sodium_mg: z.number().min(0).nullable().optional(),
  }),
  servings: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(120),
        grams: z.number().positive().max(100000),
        isDefault: z.boolean(),
      }),
    )
    .max(25),
  dataUpdatedAt: z.string().nullable(),
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
    food = foodSchema.parse(JSON.parse(parsed.data.food)) as Food;
  } catch {
    return { error: "That food could not be read. Search for it again." };
  }

  const userId = await requireUserId();
  const supabase = await createClient();

  // Cache first, so the entry references a real row and the same food is not
  // fetched from a provider again next time.
  const foodId = await cacheFood(food);

  // Read the nutrients back from the database rather than using the payload.
  // This is what makes the invariant structural: whatever the client sent,
  // the entry is computed from what is actually stored.
  const { data: nutrients, error: nutrientError } = await supabase
    .from("food_nutrients")
    .select("kcal, protein_g, carbs_g, fat_g")
    .eq("food_id", foodId)
    .single();
  if (nutrientError || !nutrients) {
    return { error: "That food has no nutrition data recorded." };
  }

  const { data: servingRows, error: servingError } = await supabase
    .from("food_servings")
    .select("id, label, grams")
    .eq("food_id", foodId);
  if (servingError) return { error: servingError.message };

  const chosenServing =
    parsed.data.unit === "serving"
      ? (servingRows ?? []).find(
          (s) => s.label === parsed.data.servingLabel,
        ) ?? null
      : null;

  if (parsed.data.unit === "serving" && !chosenServing) {
    return { error: "That serving is no longer available. Pick another." };
  }

  let grams: number;
  try {
    grams = toGrams({
      amount: parsed.data.amount,
      unit: parsed.data.unit,
      serving: chosenServing ? { grams: Number(chosenServing.grams) } : null,
    });
  } catch {
    return { error: "That amount could not be converted to grams." };
  }

  const macros = scaleNutrients(
    {
      kcal: Number(nutrients.kcal),
      protein_g: Number(nutrients.protein_g),
      carbs_g: Number(nutrients.carbs_g),
      fat_g: Number(nutrients.fat_g),
    },
    grams,
  );

  const { error: insertError } = await supabase.from("food_logs").insert({
    user_id: userId,
    log_date: parsed.data.logDate,
    meal_type_id: parsed.data.mealTypeId,
    food_id: foodId,
    serving_id: chosenServing?.id ?? null,
    amount: parsed.data.amount,
    unit: parsed.data.unit,
    grams,
    kcal: macros.kcal,
    protein_g: macros.protein_g,
    carbs_g: macros.carbs_g,
    fat_g: macros.fat_g,
    source: "manual",
  });
  if (insertError) return { error: insertError.message };

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

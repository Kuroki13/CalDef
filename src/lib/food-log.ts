import "server-only";

/**
 * Writing one diary entry for a food that is already cached.
 *
 * This is the convergence point ARCHITECTURE §4 describes, factored out so
 * every path that logs a single food goes through it: the manual search, a
 * favourite, a scanned barcode, and later the AI parser. Whatever the caller
 * knows about the food, the macros written to the row are computed here from
 * the `food_nutrients` row the database actually holds — never from a
 * provider payload, a form field or a model response.
 *
 * Recipes and saved meals do not come through here. A recipe writes one
 * entry composed from its ingredients, and a saved meal expands into several
 * rows; both are in their own modules.
 */

import { scaleNutrients } from "@/lib/nutrition/macros";
import { toGrams } from "@/lib/nutrition/units";
import { createClient, requireUserId } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type PortionUnit = Database["public"]["Enums"]["portion_unit"];
export type LogSource = Database["public"]["Enums"]["log_source"];

export type LogCachedFoodInput = {
  foodId: number;
  logDate: string;
  mealTypeId: number;
  amount: number;
  unit: PortionUnit;
  /**
   * Which of the food's servings the amount refers to. Only consulted when
   * `unit` is `serving`, and required in that case — a serving amount with no
   * serving behind it would have to invent a gram weight.
   */
  servingLabel?: string | null;
  source: LogSource;
};

export async function logCachedFood(
  input: LogCachedFoodInput,
): Promise<{ ok: true } | { error: string }> {
  const userId = await requireUserId();
  const supabase = await createClient();

  // Read the nutrients back from the database rather than trusting anything
  // the caller holds. This is what makes the invariant structural.
  const { data: nutrients, error: nutrientError } = await supabase
    .from("food_nutrients")
    .select("kcal, protein_g, carbs_g, fat_g")
    .eq("food_id", input.foodId)
    .maybeSingle();
  if (nutrientError) return { error: nutrientError.message };
  if (!nutrients) return { error: "That food has no nutrition data recorded." };

  const { data: servingRows, error: servingError } = await supabase
    .from("food_servings")
    .select("id, label, grams")
    .eq("food_id", input.foodId);
  if (servingError) return { error: servingError.message };

  const chosenServing =
    input.unit === "serving"
      ? ((servingRows ?? []).find((s) => s.label === input.servingLabel) ?? null)
      : null;

  if (input.unit === "serving" && !chosenServing) {
    return { error: "That serving is no longer available. Pick another." };
  }

  let grams: number;
  try {
    grams = toGrams({
      amount: input.amount,
      unit: input.unit,
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
    log_date: input.logDate,
    meal_type_id: input.mealTypeId,
    food_id: input.foodId,
    serving_id: chosenServing?.id ?? null,
    amount: input.amount,
    unit: input.unit,
    grams,
    kcal: macros.kcal,
    protein_g: macros.protein_g,
    carbs_g: macros.carbs_g,
    fat_g: macros.fat_g,
    source: input.source,
  });
  if (insertError) return { error: insertError.message };

  return { ok: true };
}

export type UpdateEntryPortionInput = {
  entryId: number;
  amount: number;
  /** Defaults to the unit the entry already carries. */
  unit?: PortionUnit;
};

/**
 * Changes an entry's portion, recomputing its macros from the stored row.
 *
 * The counterpart to `logCachedFood`, and it exists for the same reason: an
 * amended entry has to be recomputed from `food_nutrients`, not scaled from
 * whatever the client believes the old figure was. Both the manual edit and
 * the AI correction go through here, so the two cannot drift.
 *
 * A recipe-backed entry has no single food to recompute against and is
 * refused rather than half-updated.
 */
export async function updateEntryPortion(
  input: UpdateEntryPortionInput,
): Promise<{ ok: true } | { error: string }> {
  await requireUserId();
  const supabase = await createClient();

  const { data: entry, error } = await supabase
    .from("food_logs")
    .select("id, food_id, serving_id, amount, unit")
    .eq("id", input.entryId)
    .maybeSingle();
  if (error) return { error: error.message };
  // RLS makes another user's entry invisible, so this covers both "gone" and
  // "not yours" without leaking which.
  if (!entry) return { error: "That entry no longer exists." };
  if (entry.food_id === null) {
    return { error: "Edit a recipe entry from the recipe itself." };
  }

  const unit = input.unit ?? (entry.unit as PortionUnit);

  const { data: nutrients } = await supabase
    .from("food_nutrients")
    .select("kcal, protein_g, carbs_g, fat_g")
    .eq("food_id", entry.food_id)
    .maybeSingle();
  if (!nutrients) return { error: "That food has no nutrition data." };

  let servingGrams: number | null = null;
  if (unit === "serving") {
    // The entry's own serving when it has one, otherwise the food's default:
    // a correction may be turning a gram amount into servings for the first
    // time, in which case there is no serving on the row yet.
    const { data: servings } = await supabase
      .from("food_servings")
      .select("id, grams, is_default")
      .eq("food_id", entry.food_id);

    const chosen =
      (servings ?? []).find((s) => s.id === entry.serving_id) ??
      (servings ?? []).find((s) => s.is_default) ??
      (servings ?? [])[0];

    if (!chosen) return { error: "That food has no serving to measure by." };
    servingGrams = Number(chosen.grams);
  }

  let grams: number;
  try {
    grams = toGrams({
      amount: input.amount,
      unit,
      serving: servingGrams === null ? null : { grams: servingGrams },
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

  const { error: updateError } = await supabase
    .from("food_logs")
    .update({
      amount: input.amount,
      unit,
      grams,
      kcal: macros.kcal,
      protein_g: macros.protein_g,
      carbs_g: macros.carbs_g,
      fat_g: macros.fat_g,
    })
    .eq("id", input.entryId);
  if (updateError) return { error: updateError.message };

  return { ok: true };
}

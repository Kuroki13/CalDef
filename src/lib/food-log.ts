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

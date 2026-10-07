import "server-only";

/**
 * Writes a Quick Add (spec §12G).
 *
 * A diary row attached to no food: `is_estimate`, labelled by `notes`,
 * with no weight because nobody weighed it. It is not cached anywhere, it
 * creates no food, and it does not appear in search or in My Foods — it is
 * one entry on one day. Making it a reusable food is a separate, explicit
 * act (the custom food form), never a side effect of this.
 */

import { type QuickAddInput, checkQuickAdd } from "@/lib/quick-add-input";
import { createClient, requireUserId } from "@/lib/supabase/server";

export async function quickAdd(
  input: QuickAddInput,
): Promise<{ ok: true } | { error: string }> {
  const problem = checkQuickAdd(input);
  if (problem) return { error: problem };

  const userId = await requireUserId();
  const supabase = await createClient();

  const { error } = await supabase.from("food_logs").insert({
    user_id: userId,
    log_date: input.logDate,
    meal_type_id: input.mealTypeId,
    amount: 1,
    unit: "serving",
    grams: null,
    kcal: input.kcal,
    protein_g: input.protein_g,
    carbs_g: input.carbs_g,
    fat_g: input.fat_g,
    source: "manual",
    notes: input.label,
    is_estimate: true,
  });
  if (error) return { error: error.message };
  return { ok: true };
}

import "server-only";

/**
 * Log it again (spec §12E).
 *
 * Repeating a food, a breakfast or yesterday's lunch is not copying rows.
 * The source entry contributes only *what* was eaten — which food or recipe,
 * which unit, which serving — and the amount comes from the user, who may
 * have changed it. The figures are then computed exactly as they would be
 * for a fresh log: `logCachedFood` re-reads the food's nutrients, and
 * `logRecipe` re-reads the recipe. So an entry logged before a label was
 * corrected is repeated with the corrected label, and nothing in an old row
 * — least of all a calorie figure — is carried forward. The one exception
 * is a Quick Add, which has no food to recompute from; see `repeatEstimate`.
 *
 * Source entries are read under RLS, so only the caller's own can be
 * repeated; someone else's id simply is not found.
 */

import { logCachedFood } from "@/lib/food-log";
import { logRecipe } from "@/lib/recipes";
import { createClient, requireUserId } from "@/lib/supabase/server";

export type RepeatItem = {
  entryId: number;
  /** In the source entry's own unit: grams, millilitres or servings. */
  amount: number;
};

export type RepeatInput = {
  logDate: string;
  mealTypeId: number;
  items: RepeatItem[];
};

export type RepeatOutcome =
  | { logged: number; failed: { name: string; reason: string }[] }
  | { error: string };

/** More than a day's meal is not a repeat, it is a mistake. */
export const MAX_REPEAT_ITEMS = 30;

export async function repeatEntries(input: RepeatInput): Promise<RepeatOutcome> {
  if (input.items.length === 0) return { error: "Choose at least one item." };
  if (input.items.length > MAX_REPEAT_ITEMS) {
    return { error: `At most ${MAX_REPEAT_ITEMS} items at a time.` };
  }

  const supabase = await createClient();
  const ids = [...new Set(input.items.map((item) => item.entryId))];

  const { data, error } = await supabase
    .from("food_logs")
    .select(
      `id, food_id, recipe_id, unit, notes, is_estimate,
       kcal, protein_g, carbs_g, fat_g,
       foods ( name ), food_servings ( label )`,
    )
    .in("id", ids);
  if (error) return { error: error.message };

  const byId = new Map((data ?? []).map((row) => [row.id, row]));

  let logged = 0;
  const failed: { name: string; reason: string }[] = [];

  // In the order given, one at a time: each is an ordinary log, and a
  // failure part-way names what did not go in rather than leaving the user
  // to guess from their totals.
  for (const item of input.items) {
    const source = byId.get(item.entryId);
    if (!source) {
      failed.push({ name: "An entry", reason: "It is no longer in your diary." });
      continue;
    }
    const name = source.foods?.name ?? source.notes ?? "An entry";

    if (!Number.isFinite(item.amount) || item.amount <= 0) {
      failed.push({ name, reason: "The amount must be above zero." });
      continue;
    }

    const result = source.is_estimate
      ? await repeatEstimate(source, item.amount, input)
      : source.food_id !== null
        ? await logCachedFood({
            foodId: source.food_id,
            logDate: input.logDate,
            mealTypeId: input.mealTypeId,
            amount: item.amount,
            unit: source.unit,
            servingLabel: source.food_servings?.label ?? null,
            source: "manual",
          })
        : source.recipe_id !== null
          ? await logRecipe(source.recipe_id, input.logDate, input.mealTypeId, {
              amount: item.amount,
              // Grams again when it was logged in grams (a weighed dish).
              unit: source.unit === "g" ? "g" : "serving",
            })
          : { error: "There is nothing behind this entry to log again." };

    if ("error" in result) failed.push({ name, reason: result.error });
    else logged += 1;
  }

  return { logged, failed };
}

/**
 * A Quick Add, again. There is no food to recompute from, so the user's own
 * figures are what is repeated — scaled by the amount, where 1 is "the same
 * again" — and the copy is still marked as their estimate. These are the
 * only figures ever carried from an old row, because they were never
 * computed in the first place.
 */
async function repeatEstimate(
  source: {
    notes: string | null;
    kcal: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
  },
  times: number,
  target: { logDate: string; mealTypeId: number },
): Promise<{ ok: true } | { error: string }> {
  const scale = (value: number) => Math.round(Number(value) * times * 100) / 100;
  const userId = await requireUserId();
  const supabase = await createClient();
  const { error } = await supabase.from("food_logs").insert({
    user_id: userId,
    log_date: target.logDate,
    meal_type_id: target.mealTypeId,
    amount: 1,
    unit: "serving",
    grams: null,
    kcal: scale(source.kcal),
    protein_g: scale(source.protein_g),
    carbs_g: scale(source.carbs_g),
    fat_g: scale(source.fat_g),
    source: "manual",
    notes: source.notes,
    is_estimate: true,
  });
  return error ? { error: error.message } : { ok: true };
}

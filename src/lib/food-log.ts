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

import { createHash } from "node:crypto";

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
  /**
   * Made by the browser when the form opened. A retried submission carries
   * the same token, and the database's unique index turns the second write
   * into "already there" instead of a second entry (migration
   * 20261118000003). Optional: callers that have none behave as before.
   */
  clientToken?: string | null;
};

/** A diary row as computed, before it is given an owner and a key. */
export type PreparedLog = Omit<
  Database["public"]["Tables"]["food_logs"]["Insert"],
  "user_id" | "client_token"
>;

export async function logCachedFood(
  input: LogCachedFoodInput,
): Promise<{ ok: true; entryId: number } | { error: string }> {
  const prepared = await prepareCachedFoodLog(input);
  if ("error" in prepared) return prepared;
  const written = await writeLogsOnce([prepared.row], input.clientToken ?? null);
  if ("error" in written) return written;
  return { ok: true, entryId: written.ids[0] };
}

/**
 * Computes the diary row for a cached food without writing it — the same
 * figures `logCachedFood` writes, so a meal of several foods can be computed
 * in full and then written in one statement (`writeLogsOnce`).
 */
export async function prepareCachedFoodLog(
  input: Omit<LogCachedFoodInput, "clientToken">,
): Promise<{ row: PreparedLog } | { error: string }> {
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

  return {
    row: {
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
    },
  };
}

/**
 * The client token of each row of one operation.
 *
 * A form makes one operation key when it opens. Each row's token is derived
 * from the key and the row's position — deterministically, so a retried
 * submission produces the same tokens and meets the unique index on
 * `(user_id, client_token)` (migration 20261118000003). A single entry is
 * position 0 like any other, so an operation's rows always form one family,
 * however many there are.
 */
export function operationTokens(operationKey: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const hex = createHash("sha256").update(`${operationKey}#${index}`).digest("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  });
}

/**
 * Positions read back when an operation arrives twice — beyond the largest
 * one any form can send (AI review 20, a repeat 30, a parts order 25), so a
 * retry with fewer or more rows than the first attempt is recognised.
 */
const FAMILY = 64;

export const ALREADY_RECORDED_DIFFERENTLY =
  "This was already added with different details, so nothing new was written. Check the diary, then add it again from a fresh form.";

/** Whether a stored row is the one this operation would write. */
function sameEntry(
  stored: {
    log_date: string;
    meal_type_id: number;
    food_id: number | null;
    recipe_id: number | null;
    amount: number;
    unit: string;
    is_estimate: boolean | null;
    kcal: number;
  },
  wanted: PreparedLog,
): boolean {
  return (
    stored.log_date === wanted.log_date &&
    stored.meal_type_id === wanted.meal_type_id &&
    (stored.food_id ?? null) === (wanted.food_id ?? null) &&
    (stored.recipe_id ?? null) === (wanted.recipe_id ?? null) &&
    Number(stored.amount) === Number(wanted.amount) &&
    stored.unit === wanted.unit &&
    (stored.is_estimate ?? false) === (wanted.is_estimate ?? false) &&
    // A user's own figures (Quick Add) are the content itself.
    (!stored.is_estimate || Math.abs(Number(stored.kcal) - Number(wanted.kcal)) < 0.01)
  );
}

/**
 * Writes the rows of one operation once — all of them, or none.
 *
 * One `insert` statement, so a meal is atomic: it cannot be half written.
 * With an operation key, a retried submission is answered with the rows the
 * first one wrote, and nothing is written twice. A key that comes back with
 * different contents is refused rather than silently answered with rows the
 * user did not ask for this time. Without a key it behaves as a plain
 * insert. Rows are owned by the signed-in user; RLS confines both the write
 * and the read-back to them.
 */
export async function writeLogsOnce(
  rows: PreparedLog[],
  operationKey: string | null,
): Promise<{ ids: number[]; replayed: boolean } | { error: string }> {
  if (rows.length === 0) return { error: "Nothing to add." };
  const userId = await requireUserId();
  const supabase = await createClient();
  const tokens = operationKey ? operationTokens(operationKey, rows.length) : null;

  const { data, error } = await supabase
    .from("food_logs")
    .insert(rows.map((row, index) => ({ ...row, user_id: userId, client_token: tokens?.[index] ?? null })))
    .select("id, client_token");

  if (!error) {
    if (!tokens) return { ids: (data ?? []).map((row) => row.id), replayed: false };
    const byToken = new Map((data ?? []).map((row) => [row.client_token, row.id]));
    return { ids: tokens.map((token) => byToken.get(token) as number), replayed: false };
  }

  if (error.code !== "23505" || !tokens || !operationKey) return { error: error.message };

  // The same operation arrived again. Its rows were written by the first
  // one, all of them, because they went in as one statement.
  const { data: stored, error: readError } = await supabase
    .from("food_logs")
    .select("id, client_token, log_date, meal_type_id, food_id, recipe_id, amount, unit, is_estimate, kcal")
    .in("client_token", operationTokens(operationKey, Math.max(FAMILY, rows.length)));
  if (readError) return { error: readError.message };

  const byToken = new Map((stored ?? []).map((row) => [row.client_token, row]));
  const matches = (stored ?? []).length === rows.length && tokens.every((token, index) => {
    const row = byToken.get(token);
    return row !== undefined && sameEntry(row, rows[index]);
  });
  if (!matches) return { error: ALREADY_RECORDED_DIFFERENTLY };
  return { ids: tokens.map((token) => byToken.get(token)!.id), replayed: true };
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

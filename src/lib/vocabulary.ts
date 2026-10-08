import "server-only";

/**
 * Personal vocabulary (spec §13I): what a phrase means to this user.
 *
 * Learned only from what the user does — searching a phrase and logging
 * what they picked — and used only for them. RLS keeps every row to its
 * owner, so a word is never redefined for anyone else, and every row can be
 * listed and deleted here, so every mapping is editable and reversible.
 * Nothing in this module is ever sent to a model (§13.2).
 *
 * Learning must never cost the user their log: a failure to record a choice
 * is swallowed, because the entry itself has already been written.
 */

import { createClient } from "@/lib/supabase/server";
import { phraseKey } from "@/lib/vocabulary-key";

export type LearnedPick = {
  vocabularyId: number;
  foodId: number | null;
  recipeId: number | null;
  count: number;
};

export type VocabularyEntry = LearnedPick & {
  phrase: string;
  /** What the phrase leads to, by name. */
  itemName: string;
  lastChosenAt: string;
};

/** Records that `phrase` was answered by this food or recipe. Never throws. */
export async function recordChoice(
  phrase: string | null | undefined,
  target: { foodId: number } | { recipeId: number },
): Promise<void> {
  const text = (phrase ?? "").trim();
  const key = phraseKey(text);
  if (!key || text.length > 200) return;
  try {
    const supabase = await createClient();
    await supabase.rpc("record_food_choice", {
      p_phrase_key: key,
      p_phrase: text,
      p_food_id: "foodId" in target ? target.foodId : null,
      p_recipe_id: "recipeId" in target ? target.recipeId : null,
    } as never);
  } catch {
    // The diary entry is written; a missed lesson is not worth an error.
  }
}

/** What this user has chosen for this phrase before, most chosen first. */
export async function learnedFor(phrase: string): Promise<LearnedPick[]> {
  const key = phraseKey(phrase);
  if (!key) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("food_vocabulary")
    .select("id, food_id, recipe_id, choice_count")
    .eq("phrase_key", key)
    .order("choice_count", { ascending: false })
    .limit(10);
  if (error || !data) return [];
  return data.map((row) => ({
    vocabularyId: row.id,
    foodId: row.food_id,
    recipeId: row.recipe_id,
    count: row.choice_count,
  }));
}

/** Everything learned, for the user to read and correct. */
export async function listVocabulary(): Promise<VocabularyEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("food_vocabulary")
    .select("id, phrase, food_id, recipe_id, choice_count, last_chosen_at, foods ( name ), recipes ( name )")
    .order("last_chosen_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    vocabularyId: row.id,
    phrase: row.phrase,
    foodId: row.food_id,
    recipeId: row.recipe_id,
    count: row.choice_count,
    lastChosenAt: row.last_chosen_at,
    itemName: row.foods?.name ?? row.recipes?.name ?? "A food that no longer exists",
  }));
}

/** Forgets one learned mapping. RLS makes another user's id a no-op. */
export async function forgetVocabulary(id: number): Promise<void> {
  const supabase = await createClient();
  await supabase.from("food_vocabulary").delete().eq("id", id);
}

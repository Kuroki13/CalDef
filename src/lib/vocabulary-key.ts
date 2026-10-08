/**
 * The key a personal phrase is remembered under (spec §13I).
 *
 * "Warak", "warak" and "wara2" are one phrase; "200 g warak" and "warak"
 * are too, because the amount is not part of what the word means. Words are
 * keyed the way every food word in the app is compared
 * (`cultural/normalize.ts`), so learning follows the same spelling rules
 * search does.
 *
 * Pure.
 */

import { wordKey, words } from "@/lib/food/cultural/normalize";

/** Units and counters that say how much, never what. */
const QUANTITY_WORDS = new Set([
  "g", "gr", "gram", "grams", "gramme", "grammes", "kg", "ml", "cl", "l",
  "x", "piece", "pieces", "pcs", "serving", "servings", "portion", "portions",
  "cup", "cups", "tbsp", "tsp", "slice", "slices",
]);

/** After this many choices of one item for one phrase, it comes first. */
export const PINNED_AT = 2;

export function phraseKey(text: string): string {
  return words(text)
    .filter((word) => !QUANTITY_WORDS.has(word.toLowerCase()))
    .map(wordKey)
    .filter((key) => key.length > 0)
    .join(" ")
    .slice(0, 200);
}

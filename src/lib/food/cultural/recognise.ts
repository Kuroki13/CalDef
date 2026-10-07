/**
 * Recognising dishes in what someone typed (spec §13A–§13D).
 *
 * "ma2loubeh djej" → Maqluba, chicken. "À midi 8 warak enab viande" →
 * stuffed grape leaves, with meat. "مقلوبة" → Maqluba, variant not said.
 *
 * Deterministic and local: no model is asked, nothing leaves the server,
 * and the same text always gives the same answer. Recognition says what a
 * word *names*; it attaches no nutrition, and when a dish's variants differ
 * materially and the text does not say which, it reports that the question
 * is open rather than picking one (§13D, "never collapse nutritionally
 * different foods").
 *
 * Pure.
 */

import { type Dish, DISHES, type Variant } from "@/lib/food/cultural/dictionary";
import { closeEnough, isArabic, wordKey, words } from "@/lib/food/cultural/normalize";

export type Recognised = {
  dish: Dish;
  /** The variant the text names, if it names one. */
  variant: Variant | null;
  /** True when the dish has variants and the text did not choose one. */
  variantOpen: boolean;
  /** The words of the text that named the dish. */
  matched: string;
  /** What to search the databases with: the variant's phrase if known. */
  searchAs: string;
  /** Where in the word list the dish was named, for proximity. */
  start: number;
  end: number;
};

type Alias = {
  dish: Dish;
  keys: string[];
  /** The alias's own words, lower-cased and accent-folded. */
  raw: string[];
  arabic: boolean;
  text: string;
};

const plain = (word: string) =>
  word.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Every alias of every dish, keyed once. */
const INDEX: Alias[] = DISHES.flatMap((dish) => {
  const latin = [dish.name, ...dish.aliases].map((text) => ({ text, arabic: false }));
  const arabic = [dish.arabic, ...(dish.arabicAliases ?? [])].map((text) => ({ text, arabic: true }));
  return [...latin, ...arabic].map(({ text, arabic: isAr }) => ({
    dish,
    text,
    arabic: isAr,
    keys: words(text).map(wordKey).filter((k) => k.length > 0),
    raw: words(text).map(plain),
  }));
}).filter((alias) => alias.keys.length > 0);

const LONGEST = Math.max(...INDEX.map((a) => a.keys.length));

/**
 * Whether a run of input keys matches an alias. Arabic must match exactly
 * after normalisation; Latin is allowed the narrow slip `closeEnough`
 * permits, but only for single-word aliases of four or more letters and
 * never for the very short ones ("ful", "laban") where one letter is a
 * different food.
 */
function matches(
  input: string[],
  rawInput: string[],
  alias: Alias,
  fuzzy: boolean,
): boolean {
  if (input.length !== alias.keys.length) return false;
  if (alias.arabic) return input.every((k, i) => k === alias.keys[i]);
  return input.every((k, i) => {
    // A key of three letters or fewer is too coarse to trust: "full"
    // collapses to "ful", which is a dish. Those must be typed as written.
    if (alias.keys[i].length <= 3) return plain(rawInput[i] ?? "") === alias.raw[i];
    if (k === alias.keys[i]) return true;
    // A slip is forgiven only between two long words: at five letters one
    // letter is the difference between laban and labaneh.
    return (
      fuzzy &&
      alias.keys.length === 1 &&
      alias.keys[0].length >= 6 &&
      k.length >= 6 &&
      closeEnough(k, alias.keys[i])
    );
  });
}

/**
 * An Arabic word may carry a leading conjunction or preposition glued on:
 * "ومقلوبة" (and maqluba), "بلبن" (with laban). Try it bare as well.
 */
function arabicForms(key: string): string[] {
  const forms = [key];
  if (key.length > 3 && /^[وبفل]/.test(key)) forms.push(key.slice(1));
  return forms;
}

function findVariant(dish: Dish, keys: Set<string>, rawWords: string[]): Variant | null {
  if (!dish.variants) return null;
  // An alias that names a variant outright decides it.
  for (const word of rawWords) {
    const implied = dish.impliedVariants?.[word.toLowerCase()] ?? dish.impliedVariants?.[word];
    if (implied) return dish.variants.find((v) => v.id === implied) ?? null;
  }
  for (const variant of dish.variants) {
    for (const marker of variant.markers) {
      const markerKeys = words(marker).map(wordKey);
      if (markerKeys.length > 0 && markerKeys.every((k) => keys.has(k))) return variant;
    }
  }
  return null;
}

/** How far either side of a dish a variant word may sit and still belong to it. */
const VARIANT_WINDOW = 3;

export function recognise(text: string): Recognised[] {
  const rawWords = words(text);
  const keys = rawWords.map((w) => wordKey(w));
  const found: Recognised[] = [];

  let i = 0;
  while (i < keys.length) {
    let hit: { alias: Alias; length: number } | null = null;

    // Longest alias first, so "warak enab" beats "warak".
    for (let length = Math.min(LONGEST, keys.length - i); length >= 1 && !hit; length--) {
      const slice = keys.slice(i, i + length);
      const candidates = isArabic(rawWords[i])
        ? arabicForms(slice[0]).map((first) => [first, ...slice.slice(1)])
        : [slice];
      const rawSlice = rawWords.slice(i, i + length);
      // Exact anywhere in the dictionary beats a near miss anywhere.
      for (const fuzzy of [false, true]) {
        const alias = INDEX.find((a) =>
          candidates.some((c) => matches(c, rawSlice, a, fuzzy)),
        );
        if (alias) {
          hit = { alias, length };
          break;
        }
      }
    }

    if (!hit) {
      i += 1;
      continue;
    }

    const { dish } = hit.alias;
    const start = i;
    const end = i + hit.length;
    const window = new Set(
      keys.slice(Math.max(0, start - VARIANT_WINDOW), end + VARIANT_WINDOW).flatMap(arabicForms),
    );
    const variant = findVariant(dish, window, rawWords.slice(start, end));

    // The same dish twice in one sentence is one dish mentioned twice.
    if (!found.some((f) => f.dish.id === dish.id)) {
      found.push({
        dish,
        variant,
        variantOpen: Boolean(dish.variants?.length) && variant === null,
        matched: rawWords.slice(start, end).join(" "),
        searchAs: variant?.searchAs ?? dish.searchAs,
        start,
        end,
      });
    }
    i = end;
  }

  return found;
}

/**
 * Whether a food's own name names this dish — so "Mom's maqlouba" counts as
 * a match for "ma2loubeh" although they share no spelling.
 */
export function namesDish(foodName: string, dishId: string): boolean {
  return recognise(foodName).some((r) => r.dish.id === dishId);
}

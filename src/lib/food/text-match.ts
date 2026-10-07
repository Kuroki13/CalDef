/**
 * Comparing what someone typed with what a provider called something.
 *
 * Shared by the ranking on the server and by the search box in the browser,
 * which is why it lives here rather than inside `registry.ts` — that module
 * is `server-only`, and the client needs the same notion of "does this
 * result actually match what I asked for" to decide whether the results are
 * worth anything.
 *
 * Pure, so both sides answer identically and the rule can be tested on its
 * own.
 */

import { normalizeArabic } from "@/lib/food/cultural/normalize";

/**
 * Lowercased, accent-folded, punctuation reduced to spaces.
 *
 * Provider names are punctuated in ways nobody types ("Chicken, breast,
 * boneless") and the branded data is multilingual — the French entries for
 * Dubai chocolate spell it "Dubaï".
 */
export function fold(value: string): string {
  // Arabic letters survive (§13A): they used to be stripped as
  // "punctuation", which made an Arabic query match nothing at all. They
  // are normalised the way Arabic search usually is, so أ/إ/آ, ة/ه and
  // ى/ي compare equal.
  return normalizeArabic(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0621-\u064A]+/g, " ")
    .trim();
}

/** The words of a query, folded. */
export function terms(text: string): string[] {
  return fold(text)
    .split(" ")
    .filter((term) => term.length > 0);
}

/**
 * Whether any result accounts for every word of the query.
 *
 * This is what separates "the database has your food" from "the database has
 * something with one of your words in it". A search for "chicken maqlouba"
 * returns chicken spread, chicken fat and chicken frankfurters — results,
 * but not the dish, and a list of near misses is exactly the moment to offer
 * a different way in.
 *
 * A single-word query is always treated as strongly matched. One word is not
 * enough to tell a poor match from a good one — "chicken" genuinely does
 * match chicken spread — and offering to draft a recipe for a bare
 * ingredient would be noise.
 */
export function hasStrongMatch(
  query: string,
  foods: readonly { name: string; brand?: string | null }[],
): boolean {
  const wanted = terms(query);
  if (wanted.length < 2) return true;

  return foods.some((food) => {
    const haystack = fold(`${food.name} ${food.brand ?? ""}`);
    return wanted.every((term) => haystack.includes(term));
  });
}

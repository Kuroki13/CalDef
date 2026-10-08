/**
 * Personal ranking of search results (spec §12C).
 *
 * The order is decided in two tiers, and the gap between them is the point:
 *
 * 1. **How much of the query a food accounts for.** The share of typed words
 *    found in its name or brand. Nothing personal crosses this line: a food
 *    that is missing a word you typed is an obviously weaker textual match,
 *    and no amount of habit may lift it over one that has every word. Fifty
 *    logged chicken breasts do not make "chicken breast" an answer to
 *    "dubai chocolate".
 *
 * 2. **Within the same coverage, a weighed score.** The literal phrase
 *    appearing intact is worth 0.5. What the user has done with the food is
 *    worth up to about one: how often they have logged it, with diminishing
 *    returns; whether recently; whether they starred it; whether it is their
 *    own. A small edge goes to verified data. So a food eaten habitually beats
 *    a stranger that merely happens to contain the phrase — USDA calls a
 *    chicken breast "Chicken, broiler, breast, meat only", which contains
 *    both words and not the phrase, and losing to "Chicken breast nuggets"
 *    on that technicality is the failure this exists to fix — while a food
 *    eaten once does not outweigh an exact phrase on its own.
 *
 * Ties keep the incoming order, which is cache first, then the fan-out.
 *
 * Pure: no I/O, the clock is passed in, and the weights are exported so the
 * tests can say what they pin.
 */

import { fold } from "@/lib/food/text-match";
import type { Food } from "@/lib/food/types";

/** What is known about one food from this user's own history. */
export type FoodUseSignal = { count: number; lastLoggedAt: string };

export type PersonalSignals = {
  /** Keyed by `foods.id`. Only cached foods can have been logged. */
  uses: ReadonlyMap<number, FoodUseSignal>;
  favorites: ReadonlySet<number>;
  now: Date;
};

export const NO_SIGNALS: PersonalSignals = {
  uses: new Map(),
  favorites: new Set(),
  now: new Date(0),
};

export const WEIGHTS = {
  phrase: 0.5,
  /** The most frequency can add, reached at `FREQUENCY_SATURATES_AT` logs. */
  frequency: 0.45,
  recentWeeks: 0.15,
  recentMonths: 0.05,
  favorite: 0.25,
  ownFood: 0.2,
  verified: 0.05,
} as const;

/** After this many logs, more of them adds nothing. */
export const FREQUENCY_SATURATES_AT = 20;

const DAY_MS = 24 * 60 * 60 * 1000;

export type TextMatch = {
  /** Share of the query's words found, 0 to 1. */
  coverage: number;
  /** Whether the whole query appears as written. */
  phrase: boolean;
};

export function textMatch(
  food: Pick<Food, "name" | "brand"> & Partial<Pick<Food, "source" | "description">>,
  query: string,
): TextMatch {
  const needle = fold(query);
  const words = needle.split(" ").filter((w) => w.length > 0);
  if (words.length === 0) return { coverage: 0, phrase: false };

  // A bilingual table keeps its other-language name in `description`
  // (§13J/§13K): "Sirop d'érable" answers "maple syrup" too.
  const bilingual = food.source === "ciqual" || food.source === "cnf";
  const haystack = fold(
    `${food.name} ${food.brand ?? ""} ${bilingual ? (food.description ?? "") : ""}`,
  );
  const found = words.filter((word) => haystack.includes(word)).length;
  return { coverage: found / words.length, phrase: haystack.includes(needle) };
}

function idOf(food: Food): number | null {
  const id = (food as { id?: number }).id;
  return typeof id === "number" ? id : null;
}

/** What the user's own history adds, from 0 to a little over 1. */
export function personalScore(food: Food, signals: PersonalSignals): number {
  let score = 0;
  const id = idOf(food);

  if (id !== null) {
    const use = signals.uses.get(id);
    if (use && use.count > 0) {
      score +=
        WEIGHTS.frequency *
        Math.min(1, Math.log2(1 + use.count) / Math.log2(1 + FREQUENCY_SATURATES_AT));

      const age = signals.now.getTime() - new Date(use.lastLoggedAt).getTime();
      if (age <= 14 * DAY_MS) score += WEIGHTS.recentWeeks;
      else if (age <= 60 * DAY_MS) score += WEIGHTS.recentMonths;
    }
    if (signals.favorites.has(id)) score += WEIGHTS.favorite;
  }

  // Custom rows in a search are only ever the caller's own (RLS), so a
  // custom source is the user having typed the food in themselves.
  if (food.source === "custom") score += WEIGHTS.ownFood;

  return score;
}

/** Everything after coverage, combined. */
export function withinTierScore(
  food: Food,
  match: TextMatch,
  signals: PersonalSignals,
): number {
  return (
    (match.phrase ? WEIGHTS.phrase : 0) +
    personalScore(food, signals) +
    (food.isVerified ? WEIGHTS.verified : 0)
  );
}

export function rankFoods<T extends Food>(
  foods: readonly T[],
  query: string,
  signals: PersonalSignals = NO_SIGNALS,
  /**
   * Foods whose names name the dish the query named (§13A), however
   * differently spelled — "Mom's maqlouba" for "ma2loubeh". They count as
   * covering the whole query, because they do: same dish, other spelling.
   */
  namesSameDish: (food: T) => boolean = () => false,
): T[] {
  const scored = foods.map((food, index) => {
    const literal = textMatch(food, query);
    const match = namesSameDish(food) ? { coverage: 1, phrase: true } : literal;
    return {
      food,
      index,
      coverage: match.coverage,
      score: withinTierScore(food, match, signals),
    };
  });

  scored.sort(
    (a, b) =>
      b.coverage - a.coverage || b.score - a.score || a.index - b.index,
  );
  return scored.map((s) => s.food);
}

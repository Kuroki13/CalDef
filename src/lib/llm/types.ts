/**
 * The `LLMProvider` port and the types that keep the spec's two AI rules
 * true by construction rather than by discipline.
 *
 * Rule one (ARCHITECTURE invariant 1): the model never produces a nutrition
 * number. Nothing in `FoodIntent`, `CorrectionIntent` or `Answer` has a
 * place to put one. A response carrying `kcal` is not rejected as an error —
 * there is simply nowhere for the value to go, so it is dropped when the
 * payload is parsed.
 *
 * Rule two (ARCHITECTURE invariant 2, CLAUDE.md): only food text and
 * anonymous figures cross the boundary. Every provider method takes
 * `FoodText`, which cannot be produced from an arbitrary string, or
 * `AnonymousFigures`, whose every field is a `number` — a name, an email or
 * a user id is not assignable to it.
 */

import type { PortionUnit } from "@/lib/nutrition/units";

declare const foodTextBrand: unique symbol;

/**
 * Text that has been checked for identifiers and is safe to send.
 *
 * The brand is unforgeable outside `@/lib/llm/food-text`, so a provider
 * method cannot be handed a raw string — including a user's name, email or
 * id — without that check having run. This is the type-level half of the
 * data-minimization rule; `toFoodText` is the runtime half.
 */
export type FoodText = string & { readonly [foodTextBrand]: true };

/**
 * One food the user mentioned, as the model understood it.
 *
 * `query` is a search term for our own providers, not a food record: the
 * backend resolves it against USDA, Open Food Facts and the cache, and every
 * calorie and macro comes from what that lookup returns.
 */
export type FoodIntent = {
  query: string;
  amount: number;
  unit: PortionUnit;
};

export type ParsedFoods = {
  foods: FoodIntent[];
};

/**
 * What a drafted recipe is, in this app's terms.
 *
 * Deliberately `ParsedFoods` and nothing else. Asking a model for the
 * ingredients of a dish it has never seen a database entry for is a
 * different *question* from parsing a sentence someone typed, but it is the
 * same *answer*: a list of things to look up and how much of each. Giving it
 * its own type would create a second shape for a model response to arrive
 * in, and a second shape is a second place for a calorie field to be added
 * one day by someone who thought it would be convenient.
 *
 * So a drafted recipe carries no nutrition, for the same structural reason
 * a parsed sentence carries none: there is nowhere to put it.
 */
export type DraftedRecipe = ParsedFoods;

/**
 * What the user wants changed about an entry they already logged.
 *
 * `unclear` is a first-class outcome rather than a failure. "Actually that
 * was more like lunch" is a sentence the model may not be able to turn into
 * an edit, and guessing at one would silently rewrite a diary entry.
 */
export type CorrectionIntent =
  | { kind: "amount"; amount: number; unit: PortionUnit }
  | { kind: "remove" }
  | { kind: "unclear" };

/**
 * The user's numbers, stripped of who they belong to.
 *
 * Every field is a `number`, which is what makes this safe structurally: a
 * name or an email is not assignable here, so the assistant cannot be handed
 * identity by accident. Weight appears only as a single current trend
 * figure — never a history, per CLAUDE.md.
 */
export type AnonymousFigures = {
  targetCalories?: number;
  targetProteinG?: number;
  caloriesToday?: number;
  proteinTodayG?: number;
  estimatedExpenditureKcal?: number;
  trendWeightKg?: number;
  weeklyChangeKg?: number;
};

/**
 * Why a call produced no answer.
 *
 * These are distinguished because the user can act on some and not others:
 * `disabled` is their own switch, `unconfigured` is a missing key,
 * `rate-limited` means waiting a minute will fix it, and the last two are
 * the model's problem. Collapsing them would send someone to check a setting
 * when the real cause is an outage — or tell them something is broken when
 * the free quota simply needs a moment.
 */
export type LLMFailure =
  | { ok: false; reason: "disabled"; message: string }
  | { ok: false; reason: "unconfigured"; message: string }
  | { ok: false; reason: "rate-limited"; message: string }
  | { ok: false; reason: "unavailable"; message: string }
  | { ok: false; reason: "unusable"; message: string };

export type LLMResult<T> = { ok: true; value: T } | LLMFailure;

/**
 * One earlier turn of a conversation, carried forward so a follow-up works.
 *
 * `text` is `FoodText` and nothing else, which is what keeps the
 * data-minimization rule structural rather than a promise: a stored message
 * is re-checked by `toFoodText` on its way back out, and one that no longer
 * passes is dropped rather than trimmed. The assistant's own replies go
 * through the same gate — it only ever saw food text and numbers, so its
 * answers cannot contain identity that never went in, but the invariant is
 * worth more when it has no exceptions.
 */
export type ChatTurn = { role: "user" | "assistant"; text: FoodText };

export type LLMProvider = {
  readonly name: string;
  /** False when there is no key, or the user has switched the AI off. */
  isAvailable(): boolean;
  /** "200g chicken and some rice" -> intents. Never nutrition figures. */
  parseFoods(text: FoodText): Promise<LLMResult<ParsedFoods>>;
  /**
   * A dish name -> the ingredients it is usually made from, and how much.
   *
   * For a home-cooked meal no food database knows — "chicken maqlouba" —
   * where the alternative is the owner typing out a dozen ingredients by
   * hand. The model proposes *what goes in it*; every figure that follows
   * comes from resolving those ingredients against the real providers, so
   * this returns the same nutrition-free shape as `parseFoods`.
   */
  draftRecipe(dish: FoodText): Promise<LLMResult<DraftedRecipe>>;
  /**
   * "actually that was 250g" against an entry the user is looking at.
   *
   * The entry is described to the model as food text and a portion — its id,
   * its owner and its stored macros stay on this side of the boundary.
   */
  parseCorrection(
    text: FoodText,
    entry: { description: FoodText; amount: number; unit: PortionUnit },
  ): Promise<LLMResult<CorrectionIntent>>;
  /**
   * A nutrition question, answered against anonymous figures and — when the
   * question is a follow-up — the food text of what was said before it.
   */
  answer(
    question: FoodText,
    figures: AnonymousFigures,
    history?: readonly ChatTurn[],
  ): Promise<LLMResult<string>>;
};

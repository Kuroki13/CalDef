/**
 * The data-minimization gate.
 *
 * CLAUDE.md forbids sending anything identifying to Gemini, and the spec
 * asks for that to be enforced structurally rather than by convention. The
 * structure is this module: `FoodText` is branded, the brand is only
 * produced here, and it is only produced for text that has been checked.
 * Every `LLMProvider` method takes `FoodText`, so there is no signature
 * anywhere that will accept a user object, a row, or an unchecked string.
 *
 * Pure and I/O-free, so the rule is unit-testable without a network.
 */

import type { FoodText } from "@/lib/llm/types";

/** Long enough for a paragraph of food, short enough to bound a prompt. */
export const MAX_FOOD_TEXT = 600;

export type FoodTextRejection =
  | "empty"
  | "too-long"
  | "email"
  | "url"
  | "identifier";

export type FoodTextResult =
  | { ok: true; value: FoodText }
  | { ok: false; reason: FoodTextRejection; message: string };

/**
 * Patterns that mean "this is not a description of food".
 *
 * Rejecting rather than stripping is deliberate. Silently deleting part of
 * what someone typed and sending the rest is worse on both counts: they are
 * not told their data was about to leave, and the model is asked to parse a
 * sentence with a hole in it. Refusing states the boundary plainly.
 */
const PATTERNS: ReadonlyArray<{
  reason: FoodTextRejection;
  test: RegExp;
  message: string;
}> = [
  {
    reason: "email",
    test: /[^\s@]+@[^\s@]+\.[^\s@]+/,
    message: "Remove the email address — food text is all that is sent.",
  },
  {
    reason: "url",
    test: /\b(?:https?:\/\/|www\.)\S+/i,
    message: "Remove the link — food text is all that is sent.",
  },
  {
    // A UUID is what a user id, conversation id or session token looks like.
    reason: "identifier",
    test: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
    message: "Remove the identifier — food text is all that is sent.",
  },
  {
    // A JWT: three base64url segments. Supabase session tokens look like this.
    reason: "identifier",
    test: /\bey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
    message: "Remove the token — food text is all that is sent.",
  },
  {
    // Nine or more consecutive digits is a phone number, an account number or
    // a barcode — never a quantity of food. Four digits (1500 g, 2000 kcal)
    // and a barcode's own route are both unaffected.
    reason: "identifier",
    test: /\d{9,}/,
    message: "Remove the long number — food text is all that is sent.",
  },
];

/**
 * Checks a raw string and brands it if it is food text.
 *
 * The only way to obtain a `FoodText`. Callers hold the result rather than
 * the input, so the checked and unchecked values are different types and
 * cannot be confused.
 */
export function toFoodText(raw: string): FoodTextResult {
  const trimmed = raw.trim().replace(/\s+/g, " ");

  if (trimmed.length === 0) {
    return { ok: false, reason: "empty", message: "Describe what you ate." };
  }
  if (trimmed.length > MAX_FOOD_TEXT) {
    return {
      ok: false,
      reason: "too-long",
      message: `Keep it under ${MAX_FOOD_TEXT} characters.`,
    };
  }

  for (const { reason, test, message } of PATTERNS) {
    if (test.test(trimmed)) return { ok: false, reason, message };
  }

  return { ok: true, value: trimmed as FoodText };
}

/**
 * For text this app composed itself, not text a user typed.
 *
 * A food's own name comes from a provider or the cache and has already been
 * through the boundary once; re-checking it would reject legitimate product
 * names that happen to contain a long code. Deliberately named so that using
 * it on user input is a visible choice rather than an easy mistake.
 */
export function trustedFoodText(value: string): FoodText {
  return value.trim().slice(0, MAX_FOOD_TEXT) as FoodText;
}

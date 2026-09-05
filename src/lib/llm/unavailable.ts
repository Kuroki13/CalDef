/**
 * The provider used when there is no AI.
 *
 * ARCHITECTURE invariant 3: the app works with the AI switched off. That is
 * only true if "off" is an ordinary, typed outcome rather than a thrown
 * error or a null that every caller has to remember to check — so every
 * entry point gets the same shaped result whether Gemini answered, is
 * switched off, or was never configured, and renders its manual alternative.
 */

import type {
  CorrectionIntent,
  LLMFailure,
  LLMProvider,
  LLMResult,
  ParsedFoods,
} from "@/lib/llm/types";

export const AI_OFF_MESSAGE =
  "The assistant is off. Search for the food and log it manually.";

export const AI_UNCONFIGURED_MESSAGE =
  "The assistant is not configured. Search for the food and log it manually.";

/**
 * @param reason `disabled` when the user's own switch is off,
 * `unconfigured` when no API key is present. The distinction reaches the UI,
 * because one is fixed in settings and the other is not fixable by the user
 * at all.
 */
export function unavailableProvider(
  reason: "disabled" | "unconfigured",
): LLMProvider {
  const failure: LLMFailure = {
    ok: false,
    reason,
    message: reason === "disabled" ? AI_OFF_MESSAGE : AI_UNCONFIGURED_MESSAGE,
  };

  const refuse = async <T>(): Promise<LLMResult<T>> => failure;

  // The arguments are deliberately ignored rather than named: this provider
  // sends nothing anywhere, so there is nothing for it to read.
  return {
    name: reason === "disabled" ? "AI disabled" : "AI unconfigured",
    isAvailable: () => false,
    parseFoods: () => refuse<ParsedFoods>(),
    parseCorrection: () => refuse<CorrectionIntent>(),
    answer: () => refuse<string>(),
  };
}

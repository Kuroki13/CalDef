import "server-only";

/**
 * Choosing a provider.
 *
 * Two things can switch the AI off and they are not the same: the account
 * owner's toggle in settings (`profiles.ai_enabled`), and a missing
 * `GEMINI_API_KEY`. Both produce a working `LLMProvider` — the unavailable
 * one — so no caller branches on null, and ARCHITECTURE invariant 3 holds
 * without every entry point remembering to check.
 */

import { hasGeminiKey } from "@/lib/env.server";
import { geminiProvider } from "@/lib/llm/gemini";
import { unavailableProvider } from "@/lib/llm/unavailable";
import type { LLMProvider } from "@/lib/llm/types";
import { createClient } from "@/lib/supabase/server";

/**
 * The provider for a given user preference.
 *
 * Takes the flag rather than reading it, so the decision is testable without
 * a database and callers that already hold a profile do not fetch it twice.
 */
export function llmFor(aiEnabled: boolean): LLMProvider {
  if (!aiEnabled) return unavailableProvider("disabled");
  if (!hasGeminiKey()) return unavailableProvider("unconfigured");
  return geminiProvider;
}

/**
 * The provider for the signed-in user.
 *
 * Reads only `ai_enabled`, and never passes the profile anywhere near the
 * model — the flag decides which provider is returned and is then finished
 * with.
 */
export async function llmForCurrentUser(): Promise<LLMProvider> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("ai_enabled")
    .maybeSingle();

  // A missing profile means the AI is not on for anyone, which is the safe
  // reading of "we do not know".
  return llmFor(data?.ai_enabled === true);
}

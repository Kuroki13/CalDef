import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { resolveIntents } from "@/lib/ai/resolve";
import { toFoodText } from "@/lib/llm/food-text";
import { llmForCurrentUser } from "@/lib/llm";
import { RATE_LIMITS, rateLimitAll, rateLimitHeaders } from "@/lib/rate-limit";
import { getUserId } from "@/lib/supabase/server";

/**
 * "Chicken maqlouba" -> ingredients -> real foods.
 *
 * For a home-cooked dish no food database holds as an entry. The model is
 * asked what goes in it and how much; every one of those answers is then
 * resolved through the same `searchFoods` fan-out the search box uses, and
 * every nutrition figure downstream comes from the matched food's own
 * nutrient row. The model contributes a list of search terms and portions —
 * exactly what it contributes when parsing a sentence, and for the same
 * reason it cannot contribute more: `FoodIntent` has three fields.
 *
 * This route proposes and writes nothing. The draft is reviewed, edited and
 * confirmed before a recipe exists, because an ingredient list a model
 * estimated is a starting point and not a measurement.
 *
 * Only the dish name crosses the boundary, checked by `toFoodText` like
 * every other thing that does.
 */

const bodySchema = z.object({
  dish: z.string().max(200),
});

export async function POST(request: NextRequest) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Two buckets, as everywhere else: this route's own, and the one every
  // Gemini call shares. Drafting is the most expensive AI action here — one
  // model call plus up to eight provider fan-outs — so it is metered before
  // any of that starts.
  const limit = rateLimitAll([
    { key: `ai-recipe-draft:${userId}`, options: RATE_LIMITS.ai },
    { key: `gemini:${userId}`, options: RATE_LIMITS.gemini },
  ]);
  const headers = rateLimitHeaders(limit.result, limit.limit);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: "Too many requests. Try again shortly.",
        reason: "too-many-requests",
      },
      { status: 429, headers },
    );
  }

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { error: "Name the dish." },
      { status: 400, headers },
    );
  }

  const dish = toFoodText(body.data.dish);
  if (!dish.ok) {
    return NextResponse.json(
      { error: dish.message, reason: dish.reason },
      { status: 400, headers },
    );
  }

  const llm = await llmForCurrentUser();
  const drafted = await llm.draftRecipe(dish.value);
  if (!drafted.ok) {
    // Includes the AI being switched off or unconfigured, which is not an
    // error so much as a different path: the client offers building the
    // recipe by hand instead.
    return NextResponse.json(
      { error: drafted.message, reason: drafted.reason },
      { status: drafted.reason === "rate-limited" ? 429 : 503, headers },
    );
  }

  if (drafted.value.foods.length === 0) {
    return NextResponse.json(
      {
        error:
          "The assistant does not know that dish. Build the recipe by hand — " +
          "search for each ingredient and add it.",
        reason: "unknown-dish",
      },
      { status: 422, headers },
    );
  }

  // Already capped at `MAX_INTENTS` by the provider; resolving is one search
  // per ingredient, which is what the rate limit above is sized against.
  const resolved = await resolveIntents(drafted.value.foods);

  return NextResponse.json(
    {
      dish: body.data.dish.trim(),
      proposals: resolved.proposals,
      degraded: resolved.degraded,
    },
    { headers },
  );
}

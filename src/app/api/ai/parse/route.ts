import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { resolveIntents } from "@/lib/ai/resolve";
import { toFoodText } from "@/lib/llm/food-text";
import { llmForCurrentUser } from "@/lib/llm";
import { RATE_LIMITS, rateLimitAll, rateLimitHeaders } from "@/lib/rate-limit";
import { getUserId } from "@/lib/supabase/server";

/**
 * Natural language -> intent -> real foods.
 *
 * The route proposes; it does not write. Nothing reaches the diary until the
 * user confirms through the ordinary logging action, so a misread sentence
 * costs a glance rather than a wrong entry.
 *
 * Order is the same as the search route's and for the same reasons:
 * authenticate, rate limit, then validate. The one addition is that the
 * text is checked for identifiers before the model is reached at all —
 * `toFoodText` is what makes the boundary a type rather than a habit.
 */

const bodySchema = z.object({
  text: z.string().max(2000),
});

export async function POST(request: NextRequest) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Two buckets: this route's own, and the one every Gemini call shares.
  // Without the second, three routes at 10/min each could make 30 requests a
  // minute against a model whose free tier allows 15.
  const limit = rateLimitAll([
    { key: `ai-parse:${userId}`, options: RATE_LIMITS.ai },
    { key: `gemini:${userId}`, options: RATE_LIMITS.gemini },
  ]);
  const headers = rateLimitHeaders(limit.result, limit.limit);
  if (!limit.allowed) {
    // `reason` distinguishes our own limiter from the provider's, which also
    // answers 429 — see the note on `rate-limited` in lib/llm/types.ts.
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
      { error: "Describe what you ate." },
      { status: 400, headers },
    );
  }

  const text = toFoodText(body.data.text);
  if (!text.ok) {
    // The rejection reason is the user's to see: it tells them what to take
    // out, and it is the visible half of the promise that only food text is
    // ever sent.
    return NextResponse.json(
      { error: text.message, reason: text.reason },
      { status: 400, headers },
    );
  }

  const llm = await llmForCurrentUser();
  const parsed = await llm.parseFoods(text.value);
  if (!parsed.ok) {
    // 503 rather than 500: the app is working, one optional part of it is
    // not. The client renders the manual path on this.
    return NextResponse.json(
      { error: parsed.message, reason: parsed.reason },
      { status: parsed.reason === "rate-limited" ? 429 : 503, headers },
    );
  }

  if (parsed.value.foods.length === 0) {
    return NextResponse.json(
      { proposals: [], degraded: false, notice: "No food found in that." },
      { headers },
    );
  }

  const { proposals, degraded } = await resolveIntents(parsed.value.foods);

  return NextResponse.json({ proposals, degraded }, { headers });
}

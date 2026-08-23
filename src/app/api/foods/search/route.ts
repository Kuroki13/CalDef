import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { searchFoods } from "@/lib/food/registry";
import { describeDegradation } from "@/lib/food/registry";
import { RATE_LIMITS, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { getUserId } from "@/lib/supabase/server";

/**
 * Provider-backed food search.
 *
 * This route exists so the browser never talks to USDA or Open Food Facts
 * directly — their keys are server-only, and ARCHITECTURE §2 makes that a
 * structural rule rather than a preference.
 *
 * Order matters: authenticate, then rate limit, then validate. Rate limiting
 * before authentication would let an unauthenticated caller consume another
 * user's budget, and validating before rate limiting would let malformed
 * requests pass through the limiter for free.
 */

const querySchema = z.object({
  q: z.string().trim().min(2, "Search for at least two characters.").max(100),
  limit: z.coerce.number().int().min(1).max(25).default(15),
});

export async function GET(request: NextRequest) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const limit = rateLimit(`food-search:${userId}`, RATE_LIMITS.foodSearch);
  const headers = rateLimitHeaders(limit, RATE_LIMITS.foodSearch.limit);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many searches. Try again shortly." },
      { status: 429, headers },
    );
  }

  const parsed = querySchema.safeParse({
    q: request.nextUrl.searchParams.get("q") ?? "",
    limit: request.nextUrl.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400, headers },
    );
  }

  const outcome = await searchFoods({
    text: parsed.data.q,
    limit: parsed.data.limit,
  });

  return NextResponse.json(
    {
      foods: outcome.foods,
      degraded: outcome.degraded,
      notice: describeDegradation(outcome.results),
    },
    { headers },
  );
}
